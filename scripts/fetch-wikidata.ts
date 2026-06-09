import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { POPULAR_CLUBS } from '../src/config/clubs';
import type { ClubOption } from '../src/types';
import type { RawClubSpell, RawPlayerRecord, RawPlayersFile } from './types';

const WIKIDATA_ENDPOINT = process.env.WIKIDATA_ENDPOINT ?? 'https://query.wikidata.org/sparql';
const WIKIDATA_API_ENDPOINT = process.env.WIKIDATA_API_ENDPOINT ?? 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'LSKFootballCareerGame/1.0 local-data-generation';
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_CLUB_LIMIT = 5000;
const MAX_PLAYERS_PER_CLUB = envNumber('MAX_PLAYERS_PER_CLUB', 220);
const MAX_PLAYERS_PER_CLUB_ERA = envNumber('MAX_PLAYERS_PER_CLUB_ERA', 70);
const MIN_PLAYERS_PER_CLUB_ERA = envNumber('MIN_PLAYERS_PER_CLUB_ERA', 25);
const TARGET_ERAS = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'] as const;
const MVP_CLUB_IDS = new Set([
  'real_madrid',
  'barcelona',
  'manchester_united',
  'ac_milan',
  'bayern_munich',
  'juventus',
  'arsenal',
  'chelsea',
]);
const EXTENDED_CLUB_IDS = new Set([
  ...MVP_CLUB_IDS,
  'liverpool',
  'manchester_city',
  'inter_milan',
  'paris_saint_germain',
  'ajax',
  'borussia_dortmund',
  'tottenham_hotspur',
  'atletico_madrid',
]);
const HISTORICAL_CLUB_IDS = new Set([
  ...EXTENDED_CLUB_IDS,
  'benfica',
  'porto',
  'celtic',
  'rangers',
  'napoli',
  'roma',
  'lazio',
  'valencia',
  'sevilla',
  'santos',
  'boca_juniors',
  'river_plate',
  'flamengo',
]);
const SLOW_MODE = process.env.WIKIDATA_SLOW_MODE !== '0';
const DEFAULT_ENTITY_BATCH_SIZE = 5;
const MAX_ENTITY_BATCH_SIZE = 5;
const DEFAULT_REQUEST_DELAY_MS = SLOW_MODE ? 5000 : 4000;
const DEFAULT_CLUB_DELAY_MS = SLOW_MODE ? 60000 : 15000;
const DEFAULT_RETRY_DELAYS_MS = [3000, 8000, 15000];
const RATE_LIMIT_RETRY_DELAYS_MS = [120000, 300000, 600000];
const UPSTREAM_RETRY_DELAYS_MS = [30000, 90000, 180000];
const CLUB_CACHE_DIR = 'data/raw/wikidata-clubs';
const WIKIDATA_UNAVAILABLE_MESSAGE =
  '当前环境无法访问 Wikidata，请在 GitHub Actions 或可访问外网环境运行 npm run build:data。';
const CRITICAL_CLUB_IDS = new Set([
  'real_madrid',
  'barcelona',
  'manchester_united',
  'ac_milan',
  'bayern_munich',
  'juventus',
  'arsenal',
  'chelsea',
  'liverpool',
  'manchester_city',
]);

type SparqlValue = {
  type: string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
};

type SparqlBinding = Record<string, SparqlValue | undefined>;

type ClubSpellRow = {
  playerId: string;
  start?: string;
  end?: string;
  appearances?: number;
  goals?: number;
};

type PlayerDetail = {
  id: string;
  name?: string;
  cnName?: string;
  birthDate?: string;
  nationality?: string;
  countryIds: string[];
  positions: string[];
  positionIds: string[];
};

type EntityLabel = {
  en?: string;
  zh?: string;
};

type WbClaim = {
  mainsnak?: {
    datavalue?: {
      value?: unknown;
    };
  };
};

type WbEntity = {
  id?: string;
  labels?: Record<string, { value?: string } | undefined>;
  claims?: Record<string, WbClaim[] | undefined>;
  missing?: string;
};

type WbEntitiesResponse = {
  entities?: Record<string, WbEntity | undefined>;
  error?: {
    code?: string;
    info?: string;
  };
};

type ClubCacheFile = {
  generatedAt: string;
  complete: boolean;
  club: ClubOption;
  batchSize: number;
  targetEras?: string[];
  maxPlayersPerClub?: number;
  maxPlayersPerClubEra?: number;
  minPlayersPerClubEra?: number;
  processedBatchCount: number;
  playersWithDatedClubHistory: number;
  selectedPlayerIds?: string[];
  selectedPlayersByEra?: Record<string, number>;
  spellRows: ClubSpellRow[];
  details: PlayerDetail[];
  players?: RawPlayerRecord[];
  skippedBatches: number[];
  warnings: string[];
};

class WikidataRequestError extends Error {
  status?: number;
  retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'WikidataRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REQUEST_DELAY_MS = envNumber('WIKIDATA_REQUEST_DELAY_MS', DEFAULT_REQUEST_DELAY_MS);
const CLUB_DELAY_MS = envNumber('WIKIDATA_CLUB_DELAY_MS', DEFAULT_CLUB_DELAY_MS);
const FORCE_WIKIDATA_REFRESH = process.env.FORCE_WIKIDATA_REFRESH === '1';
type TargetEra = (typeof TARGET_ERAS)[number];

type RepresentativeProfile = {
  playerId: string;
  rows: ClubSpellRow[];
  yearsInClub: number;
  yearsByEra: Record<TargetEra, number>;
  appearances: number;
  goals: number;
  coveredEraCount: number;
  localMatch: boolean;
  representativeScore: number;
};

function bindingValue(row: SparqlBinding, key: string): string | undefined {
  const value = row[key]?.value?.trim();
  return value || undefined;
}

function entityId(uri?: string): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/\/entity\/([^/#?]+)$/) ?? uri.match(/\/statement\/([^/#?]+)$/);
  return match?.[1];
}

function parseYear(date?: string): number | undefined {
  if (!date) return undefined;
  const match = date.match(/^(-?\d{1,4})-/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1870 && year <= 2035 ? year : undefined;
}

function parseNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function requestStatus(error: unknown): number | undefined {
  return error instanceof WikidataRequestError ? error.status : undefined;
}

function retryDelayMs(error: unknown, retryIndex: number): number {
  const status = requestStatus(error);
  const retryAfter = error instanceof WikidataRequestError ? error.retryAfterMs : undefined;
  const delays =
    status === 429
      ? RATE_LIMIT_RETRY_DELAYS_MS
      : status === 502 || status === 504
        ? UPSTREAM_RETRY_DELAYS_MS
        : DEFAULT_RETRY_DELAYS_MS;
  return Math.max(delays[retryIndex] ?? DEFAULT_RETRY_DELAYS_MS[retryIndex] ?? 15000, retryAfter ?? 0);
}

function retryStatusLabel(error: unknown): string {
  const status = requestStatus(error);
  if (status === 429) return '429 rate limit';
  if (status === 502 || status === 504) return `${status} upstream`;
  return status ? String(status) : 'request';
}

async function runSparql(query: string): Promise<SparqlBinding[]> {
  try {
    const response = await fetch(WIKIDATA_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ query, format: 'json' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new WikidataRequestError(
        `Wikidata query failed: ${response.status} ${errorText.slice(0, 400)}`,
        response.status,
        retryAfterMs(response),
      );
    }

    const json = (await response.json()) as { results?: { bindings?: SparqlBinding[] } };
    if (!Array.isArray(json.results?.bindings)) {
      throw new Error('Unexpected Wikidata response shape: missing results.bindings');
    }
    return json.results.bindings;
  } finally {
    await wait(REQUEST_DELAY_MS);
  }
}

async function runSparqlWithRetry(query: string, label: string): Promise<SparqlBinding[]> {
  let lastError: unknown;
  const maxAttempts = RATE_LIMIT_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runSparql(query);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = retryDelayMs(error, attempt - 1);
        console.warn(
          `${label} failed (${retryStatusLabel(error)}, attempt ${attempt}/${maxAttempts}): ${
            error instanceof Error ? error.message : String(error)
          }. Waiting ${Math.round(delay / 1000)}s before retry...`,
        );
        await wait(delay);
      }
    }
  }
  throw lastError;
}

async function runWikidataApi(params: URLSearchParams): Promise<WbEntitiesResponse> {
  try {
    const response = await fetch(`${WIKIDATA_API_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new WikidataRequestError(
        `Wikidata API failed: ${response.status} ${errorText.slice(0, 400)}`,
        response.status,
        retryAfterMs(response),
      );
    }

    const json = (await response.json()) as WbEntitiesResponse;
    if (json.error) {
      throw new Error(`Wikidata API error: ${json.error.code ?? 'unknown'} ${json.error.info ?? ''}`);
    }
    if (!json.entities || typeof json.entities !== 'object') {
      throw new Error('Unexpected Wikidata API response shape: missing entities');
    }
    return json;
  } finally {
    await wait(REQUEST_DELAY_MS);
  }
}

async function runWikidataApiWithRetry(params: URLSearchParams, label: string): Promise<WbEntitiesResponse> {
  let lastError: unknown;
  const maxAttempts = RATE_LIMIT_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runWikidataApi(params);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = retryDelayMs(error, attempt - 1);
        console.warn(
          `${label} failed (${retryStatusLabel(error)}, attempt ${attempt}/${maxAttempts}): ${
            error instanceof Error ? error.message : String(error)
          }. Waiting ${Math.round(delay / 1000)}s before retry...`,
        );
        await wait(delay);
      }
    }
  }
  throw lastError;
}

function clubSpellsQuery(club: ClubOption, limit: number): string {
  return `
SELECT ?player ?team ?start ?end ?appearances ?goals
WHERE {
  ?player p:P54 ?teamStatement.
  ?teamStatement ps:P54 wd:${club.wikidataQid}.
  BIND(wd:${club.wikidataQid} AS ?team)

  OPTIONAL { ?teamStatement pq:P580 ?start. }
  OPTIONAL { ?teamStatement pq:P582 ?end. }
  OPTIONAL { ?teamStatement pq:P1350 ?appearances. }
  OPTIONAL { ?teamStatement pq:P1351 ?goals. }
}
ORDER BY ?player ?start
LIMIT ${limit}
`;
}

function entitiesParams(ids: string[], props: string): URLSearchParams {
  return new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: ids.join('|'),
    props,
    languages: 'en|zh',
  });
}

function ensurePlayer(players: Map<string, RawPlayerRecord>, id: string): RawPlayerRecord {
  const existing = players.get(id);
  if (existing) return existing;

  const player: RawPlayerRecord = {
    id,
    positions: [],
    clubs: [],
  };
  players.set(id, player);
  return player;
}

function addUnique(items: string[], value?: string) {
  if (value && !items.includes(value)) items.push(value);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNameKey(name?: string): string | undefined {
  if (!name) return undefined;
  const key = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return key || undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function localDataPaths(filename: string): string[] {
  const paths = new Set<string>();
  const explicitPlayersJson = process.env.LSK_LOCAL_PLAYERS_JSON;
  const localDir = process.env.LSK_LOCAL_DATA_DIR;
  if (filename === 'players_all.json' && explicitPlayersJson) paths.add(explicitPlayersJson);
  if (localDir) paths.add(`${localDir}/${filename}`);
  paths.add(`data/local/${filename}`);
  paths.add(`data/raw/${filename}`);
  paths.add(`/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/${filename}`);
  return [...paths];
}

function selectedClubsForMode(): ClubOption[] {
  const mode = process.env.WIKIDATA_CLUB_MODE ?? 'mvp';
  if (mode === 'extended') return POPULAR_CLUBS.filter((club) => EXTENDED_CLUB_IDS.has(club.clubId));
  if (mode === 'historical') return POPULAR_CLUBS.filter((club) => HISTORICAL_CLUB_IDS.has(club.clubId));
  if (mode === 'all') return POPULAR_CLUBS;
  return POPULAR_CLUBS.filter((club) => MVP_CLUB_IDS.has(club.clubId));
}

async function loadLocalNameKeys(): Promise<Set<string>> {
  for (const filePath of localDataPaths('players_all.json')) {
    try {
      const json = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      const rows = Array.isArray(json)
        ? json
        : isRecord(json) && Array.isArray(json.players)
          ? json.players
          : isRecord(json) && Array.isArray(json.data)
            ? json.data
            : [];
      const keys = new Set<string>();
      rows.filter(isRecord).forEach((row) => {
        [
          row.name,
          row.playerName,
          row.player_name,
          row.displayName,
          row.display_name,
          row.enName,
          row.nameEn,
          row.name_en,
          row.cnName,
          row.nameCn,
          row.name_cn,
          row.zhName,
        ].forEach((value) => {
          const key = normalizeNameKey(stringValue(value));
          if (key) keys.add(key);
        });
      });
      if (keys.size > 0) console.log(`Loaded ${keys.size} local LSK player name keys for representative scoring.`);
      return keys;
    } catch {
      // Optional local enhancement input.
    }
  }
  return new Set();
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function clubCachePath(club: ClubOption, partial = false): string {
  return `${CLUB_CACHE_DIR}/${club.clubId}${partial ? '.partial' : ''}.json`;
}

async function readClubCache(filePath: string): Promise<ClubCacheFile | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as ClubCacheFile;
  } catch {
    return undefined;
  }
}

function cacheMatchesCurrentSelection(
  cache: ClubCacheFile | undefined,
): cache is ClubCacheFile & { players: RawPlayerRecord[]; selectedPlayerIds: string[] } {
  if (!cache?.complete || cache.playersWithDatedClubHistory <= 0 || !cache.players?.length) return false;
  return (
    cache.maxPlayersPerClub === MAX_PLAYERS_PER_CLUB &&
    cache.maxPlayersPerClubEra === MAX_PLAYERS_PER_CLUB_ERA &&
    cache.minPlayersPerClubEra === MIN_PLAYERS_PER_CLUB_ERA &&
    TARGET_ERAS.every((era) => cache.targetEras?.includes(era)) &&
    Boolean(cache.selectedPlayerIds?.length)
  );
}

function richerCache(first?: ClubCacheFile, second?: ClubCacheFile): ClubCacheFile | undefined {
  if (!first) return second;
  if (!second) return first;
  const firstScore = (first.details?.length ?? 0) + (first.players?.length ?? 0);
  const secondScore = (second.details?.length ?? 0) + (second.players?.length ?? 0);
  return firstScore >= secondScore ? first : second;
}

async function writeClubCache(filePath: string, cache: ClubCacheFile) {
  await mkdir(CLUB_CACHE_DIR, { recursive: true });
  const nextPath = `${filePath}.next`;
  await writeFile(nextPath, `${JSON.stringify(cache, null, 2)}\n`);
  await rename(nextPath, filePath);
}

function spellRowFromBinding(row: SparqlBinding): ClubSpellRow | undefined {
  const playerId = entityId(bindingValue(row, 'player'));
  if (!playerId) return undefined;
  return {
    playerId,
    start: bindingValue(row, 'start'),
    end: bindingValue(row, 'end'),
    appearances: parseNumber(bindingValue(row, 'appearances')),
    goals: parseNumber(bindingValue(row, 'goals')),
  };
}

function countDatedPlayersFromRows(rows: ClubSpellRow[]): number {
  return unique(rows.flatMap((row) => (row.start ? row.playerId : []))).length;
}

function countDatedPlayersFromRecords(players: RawPlayerRecord[]): number {
  return players.filter((player) => player.clubs.some((spell) => spell.fromYear)).length;
}

function targetEraRange(era: TargetEra): { start: number; end: number } {
  const start = Number(era.slice(0, 4));
  return { start, end: start + 9 };
}

function rowEndYear(row: ClubSpellRow): number | undefined {
  const endYear = parseYear(row.end);
  if (endYear) return endYear;
  const startYear = parseYear(row.start);
  if (!startYear) return undefined;
  if (startYear >= CURRENT_YEAR - 4) return CURRENT_YEAR;
  return Math.min(startYear + 2, CURRENT_YEAR);
}

function rowYears(row: ClubSpellRow): number {
  const startYear = parseYear(row.start);
  const endYear = rowEndYear(row);
  if (!startYear || !endYear || endYear < startYear) return 0;
  return endYear - startYear + 1;
}

function rowYearsInEra(row: ClubSpellRow, era: TargetEra): number {
  const startYear = parseYear(row.start);
  const endYear = rowEndYear(row);
  if (!startYear || !endYear || endYear < startYear) return 0;
  const range = targetEraRange(era);
  const fromYear = Math.max(startYear, range.start);
  const toYear = Math.min(endYear, range.end);
  return fromYear <= toYear ? toYear - fromYear + 1 : 0;
}

function detailHasLocalMatch(detail: PlayerDetail | undefined, localNameKeys: Set<string>): boolean {
  if (!detail || localNameKeys.size === 0) return false;
  return [detail.name, detail.cnName].some((name) => {
    const key = normalizeNameKey(name);
    return key ? localNameKeys.has(key) : false;
  });
}

function buildRepresentativeProfiles(
  spellRows: ClubSpellRow[],
  detailCache: Map<string, PlayerDetail>,
  localNameKeys: Set<string>,
): RepresentativeProfile[] {
  const byPlayer = new Map<string, ClubSpellRow[]>();
  spellRows.forEach((row) => {
    byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row]);
  });

  return [...byPlayer.entries()]
    .map(([playerId, rows]) => {
      const yearsByEra = Object.fromEntries(TARGET_ERAS.map((era) => [era, 0])) as Record<TargetEra, number>;
      rows.forEach((row) => {
        TARGET_ERAS.forEach((era) => {
          yearsByEra[era] += rowYearsInEra(row, era);
        });
      });
      const yearsInClub = rows.reduce((sum, row) => sum + rowYears(row), 0);
      const appearances = Math.max(0, ...rows.map((row) => row.appearances ?? 0));
      const goals = Math.max(0, ...rows.map((row) => row.goals ?? 0));
      const coveredEraCount = TARGET_ERAS.filter((era) => yearsByEra[era] > 0).length;
      const localMatch = detailHasLocalMatch(detailCache.get(playerId), localNameKeys);
      const bestEraYears = Math.max(0, ...TARGET_ERAS.map((era) => yearsByEra[era]));
      const targetEraYears = TARGET_ERAS.reduce((sum, era) => sum + yearsByEra[era], 0);
      const representativeScore =
        yearsInClub * 10 +
        bestEraYears * 14 +
        targetEraYears * 4 +
        Math.log1p(appearances) * 8 +
        Math.log1p(goals) * 4 +
        coveredEraCount * 8 +
        (localMatch ? 20 : 0);
      return {
        playerId,
        rows,
        yearsInClub,
        yearsByEra,
        appearances,
        goals,
        coveredEraCount,
        localMatch,
        representativeScore,
      };
    })
    .filter((profile) => TARGET_ERAS.some((era) => profile.yearsByEra[era] > 0))
    .sort((a, b) => b.representativeScore - a.representativeScore || a.playerId.localeCompare(b.playerId));
}

function selectRepresentativePlayers(
  spellRows: ClubSpellRow[],
  detailCache: Map<string, PlayerDetail>,
  localNameKeys: Set<string>,
) {
  const profiles = buildRepresentativeProfiles(spellRows, detailCache, localNameKeys);
  const byPlayer = new Map(profiles.map((profile) => [profile.playerId, profile]));
  const selected = new Set<string>();
  const selectedByEra = Object.fromEntries(TARGET_ERAS.map((era) => [era, 0])) as Record<TargetEra, number>;

  const addProfile = (profile: RepresentativeProfile): boolean => {
    if (selected.has(profile.playerId)) return true;
    if (selected.size >= MAX_PLAYERS_PER_CLUB) return false;
    const eras = TARGET_ERAS.filter((era) => profile.yearsByEra[era] > 0);
    if (eras.length === 0) return false;
    const erasWithCapacity = eras.filter((era) => selectedByEra[era] < MAX_PLAYERS_PER_CLUB_ERA);
    if (erasWithCapacity.length === 0) return false;
    selected.add(profile.playerId);
    erasWithCapacity.forEach((era) => {
      selectedByEra[era] += 1;
    });
    return true;
  };

  const eraLists = Object.fromEntries(
    TARGET_ERAS.map((era) => [
      era,
      profiles
        .filter((profile) => profile.yearsByEra[era] > 0)
        .sort(
          (a, b) =>
            b.yearsByEra[era] - a.yearsByEra[era] ||
            b.representativeScore - a.representativeScore ||
            a.playerId.localeCompare(b.playerId),
        )
        .slice(0, MAX_PLAYERS_PER_CLUB_ERA),
    ]),
  ) as Record<TargetEra, RepresentativeProfile[]>;

  for (let rank = 0; rank < MAX_PLAYERS_PER_CLUB_ERA && selected.size < MAX_PLAYERS_PER_CLUB; rank += 1) {
    for (const era of TARGET_ERAS) {
      if (selected.size >= MAX_PLAYERS_PER_CLUB) break;
      const profile = eraLists[era][rank];
      if (profile) addProfile(profile);
    }
  }

  profiles.forEach((profile) => {
    if (selected.size < MAX_PLAYERS_PER_CLUB) addProfile(profile);
  });

  TARGET_ERAS.forEach((era) => {
    if (selectedByEra[era] < MIN_PLAYERS_PER_CLUB_ERA) {
      eraLists[era].forEach((profile) => {
        if (selectedByEra[era] < MIN_PLAYERS_PER_CLUB_ERA) addProfile(profile);
      });
    }
  });

  const selectedPlayerIds = [...selected].sort(
    (a, b) => (byPlayer.get(b)?.representativeScore ?? 0) - (byPlayer.get(a)?.representativeScore ?? 0),
  );
  return {
    selectedPlayerIds,
    selectedByEra,
    profiles,
  };
}

function detailFromRawPlayer(player: RawPlayerRecord): PlayerDetail {
  return {
    id: player.id,
    name: player.name,
    cnName: player.cnName,
    birthDate: player.birthDate,
    nationality: player.nationality,
    countryIds: [],
    positions: player.positions,
    positionIds: [],
  };
}

function mergePlayerIntoMap(player: RawPlayerRecord, players: Map<string, RawPlayerRecord>) {
  const target = ensurePlayer(players, player.id);
  target.name ||= player.name;
  target.cnName ||= player.cnName;
  target.birthDate ||= player.birthDate;
  target.nationality ||= player.nationality;
  target.sitelinks ||= player.sitelinks;
  player.positions.forEach((position) => addUnique(target.positions, position));
  player.clubs.forEach((spell) => upsertClubSpell(target, spell));
}

function cacheFromClubState(input: {
  club: ClubOption;
  complete: boolean;
  batchSize: number;
  playerIds: string[];
  selectedByEra?: Record<string, number>;
  spellRows: ClubSpellRow[];
  detailCache: Map<string, PlayerDetail>;
  players?: RawPlayerRecord[];
  skippedBatches: number[];
  warnings: string[];
}): ClubCacheFile {
  const batches = chunks(input.playerIds, input.batchSize);
  const processedBatchCount = batches.filter((batch) => batch.every((playerId) => input.detailCache.has(playerId))).length;
  return {
    generatedAt: new Date().toISOString(),
    complete: input.complete,
    club: input.club,
    batchSize: input.batchSize,
    targetEras: [...TARGET_ERAS],
    maxPlayersPerClub: MAX_PLAYERS_PER_CLUB,
    maxPlayersPerClubEra: MAX_PLAYERS_PER_CLUB_ERA,
    minPlayersPerClubEra: MIN_PLAYERS_PER_CLUB_ERA,
    processedBatchCount,
    playersWithDatedClubHistory: input.players
      ? countDatedPlayersFromRecords(input.players)
      : countDatedPlayersFromRows(input.spellRows),
    selectedPlayerIds: input.playerIds,
    selectedPlayersByEra: input.selectedByEra,
    spellRows: input.spellRows,
    details: input.playerIds.flatMap((playerId) => input.detailCache.get(playerId) ?? []),
    players: input.players,
    skippedBatches: input.skippedBatches,
    warnings: input.warnings,
  };
}

function upsertClubSpell(player: RawPlayerRecord, spell: RawClubSpell) {
  const key = `${spell.statementId}-${spell.clubId}-${spell.fromYear ?? ''}-${spell.toYear ?? ''}`;
  const exists = player.clubs.some(
    (item) => `${item.statementId}-${item.clubId}-${item.fromYear ?? ''}-${item.toYear ?? ''}` === key,
  );
  if (!exists) player.clubs.push(spell);
}

function labelFromEntity(entity?: WbEntity): EntityLabel {
  return {
    en: entity?.labels?.en?.value,
    zh: entity?.labels?.zh?.value,
  };
}

function claimValues(entity: WbEntity | undefined, propertyId: string): unknown[] {
  return (
    entity?.claims?.[propertyId]
      ?.flatMap((claim) => claim.mainsnak?.datavalue?.value ?? [])
      .filter((value) => value !== undefined) ?? []
  );
}

function claimTime(entity: WbEntity | undefined, propertyId: string): string | undefined {
  const value = claimValues(entity, propertyId)[0];
  if (typeof value === 'object' && value !== null && 'time' in value) {
    const time = (value as { time?: unknown }).time;
    return typeof time === 'string' ? time.replace(/^\+/, '') : undefined;
  }
  return undefined;
}

function claimEntityIds(entity: WbEntity | undefined, propertyId: string): string[] {
  return unique(
    claimValues(entity, propertyId).flatMap((value) => {
      if (typeof value === 'object' && value !== null && 'id' in value) {
        const id = (value as { id?: unknown }).id;
        return typeof id === 'string' ? id : [];
      }
      return [];
    }),
  );
}

function detailFromEntity(playerId: string, entity?: WbEntity): PlayerDetail {
  const label = labelFromEntity(entity);
  return {
    id: playerId,
    name: label.en,
    cnName: label.zh,
    birthDate: claimTime(entity, 'P569'),
    countryIds: claimEntityIds(entity, 'P27'),
    positions: [],
    positionIds: claimEntityIds(entity, 'P413'),
  };
}

function applyEntityLabels(detail: PlayerDetail, labelCache: Map<string, EntityLabel>) {
  detail.countryIds.forEach((countryId) => {
    const label = labelCache.get(countryId);
    detail.nationality ||= label?.zh || label?.en;
  });
  detail.positionIds.forEach((positionId) => {
    const label = labelCache.get(positionId);
    addUnique(detail.positions, label?.en);
    addUnique(detail.positions, label?.zh);
  });
}

function applyDetail(player: RawPlayerRecord, detail?: PlayerDetail) {
  if (!detail) return;
  player.name ||= detail.name;
  player.cnName ||= detail.cnName;
  player.birthDate ||= detail.birthDate;
  player.nationality ||= detail.nationality;
  detail.positions.forEach((position) => addUnique(player.positions, position));
}

async function fetchMissingEntityLabels(
  ids: string[],
  labelCache: Map<string, EntityLabel>,
  batchSize: number,
  warnings: string[],
) {
  const missingIds = ids.filter((id) => !labelCache.has(id));
  const batches = chunks(unique(missingIds), batchSize);

  for (const [index, batch] of batches.entries()) {
    try {
      const json = await runWikidataApiWithRetry(
        entitiesParams(batch, 'labels'),
        `entity labels batch ${index + 1}/${batches.length}`,
      );
      Object.entries(json.entities ?? {}).forEach(([entityId, entity]) => {
        labelCache.set(entityId, labelFromEntity(entity));
      });
    } catch (error) {
      const warning = `Skipped entity labels batch ${index + 1}/${batches.length}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      warnings.push(warning);
      console.warn(warning);
      batch.forEach((id) => labelCache.set(id, {}));
    }
  }
}

async function fetchMissingDetails(
  club: ClubOption,
  playerIds: string[],
  detailCache: Map<string, PlayerDetail>,
  labelCache: Map<string, EntityLabel>,
  batchSize: number,
  warnings: string[],
  skippedBatches: number[],
  savePartial: () => Promise<void>,
) {
  const batches = chunks(playerIds, batchSize);
  const firstIncompleteBatch = batches.findIndex((batch) => batch.some((id) => !detailCache.has(id)));

  if (firstIncompleteBatch === -1) {
    console.log(`${club.clubName} details: ${playerIds.length} players (cache hit).`);
    return;
  }

  if (firstIncompleteBatch > 0) {
    console.log(`Resuming ${club.clubName} from batch ${firstIncompleteBatch + 1}/${batches.length}.`);
  }

  let fetchedRows = 0;
  for (const [index, batch] of batches.entries()) {
    if (batch.every((playerId) => detailCache.has(playerId))) {
      continue;
    }

    try {
      console.log(
        `Fetching ${club.clubName} entities batch ${index + 1}/${batches.length} via wbgetentities (${batch.length} players)...`,
      );
      const json = await runWikidataApiWithRetry(
        entitiesParams(batch, 'labels|claims'),
        `${club.clubName} entities batch ${index + 1}/${batches.length}`,
      );
      const details = new Map<string, PlayerDetail>();
      batch.forEach((playerId) => {
        const detail = detailFromEntity(playerId, json.entities?.[playerId]);
        details.set(playerId, detail);
      });

      const referencedEntityIds = unique(
        [...details.values()].flatMap((detail) => [...detail.countryIds, ...detail.positionIds]),
      );
      await fetchMissingEntityLabels(referencedEntityIds, labelCache, batchSize, warnings);

      details.forEach((detail) => {
        applyEntityLabels(detail, labelCache);
        detailCache.set(detail.id, detail);
      });
      fetchedRows += details.size;
      console.log(`${club.clubName} entities batch ${index + 1}/${batches.length} success: ${details.size} players.`);
    } catch (error) {
      const warning = `Skipped ${club.clubName} details batch ${index + 1}/${batches.length}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      warnings.push(warning);
      console.warn(warning);
      skippedBatches.push(index + 1);
      batch.forEach((playerId) => {
        detailCache.set(playerId, { id: playerId, countryIds: [], positions: [], positionIds: [] });
      });
    } finally {
      await savePartial();
    }
  }

  console.log(`${club.clubName} details: ${playerIds.length} players, ${fetchedRows} fetched entities via wbgetentities.`);
}

function collectClubRows(
  club: ClubOption,
  rows: ClubSpellRow[],
  detailCache: Map<string, PlayerDetail>,
  players: Map<string, RawPlayerRecord>,
) {
  rows.forEach((row) => {
    const player = ensurePlayer(players, row.playerId);
    applyDetail(player, detailCache.get(row.playerId));

    upsertClubSpell(player, {
      statementId: `${row.playerId}-${club.wikidataQid}-${row.start ?? ''}-${row.end ?? ''}`,
      clubId: club.clubId,
      clubName: club.clubName,
      clubCnName: club.clubCnName,
      fromTime: row.start,
      toTime: row.end,
      fromYear: parseYear(row.start),
      toYear: parseYear(row.end),
    });
  });
}

export async function fetchWikidata() {
  const limit = Number(process.env.WIKIDATA_CLUB_LIMIT ?? '') || numberArg('club-limit', DEFAULT_CLUB_LIMIT);
  const requestedEntityBatchSize =
    Number(process.env.WIKIDATA_ENTITY_BATCH_SIZE ?? '') || numberArg('entity-batch-size', DEFAULT_ENTITY_BATCH_SIZE);
  const entityBatchSize = Math.min(requestedEntityBatchSize, MAX_ENTITY_BATCH_SIZE);
  const clubMode = process.env.WIKIDATA_CLUB_MODE ?? 'mvp';
  const selectedClubs = selectedClubsForMode();
  const localNameKeys = await loadLocalNameKeys();
  const players = new Map<string, RawPlayerRecord>();
  const detailCache = new Map<string, PlayerDetail>();
  const labelCache = new Map<string, EntityLabel>();
  const warnings: string[] = [];
  const failedClubs: string[] = [];
  const selectedPlayersByClub: Record<string, number> = {};
  const selectedPlayersByClubEra: Record<string, Record<string, number>> = {};

  console.log(
    `Wikidata fetch config: clubMode=${clubMode}, clubs=${selectedClubs.length}, targetEras=${TARGET_ERAS.join('|')}, maxPlayersPerClub=${MAX_PLAYERS_PER_CLUB}, maxPlayersPerClubEra=${MAX_PLAYERS_PER_CLUB_ERA}, minPlayersPerClubEra=${MIN_PLAYERS_PER_CLUB_ERA}, slowMode=${SLOW_MODE ? 'on' : 'off'}, entityBatchSize=${entityBatchSize}, requestDelay=${REQUEST_DELAY_MS}ms, clubDelay=${CLUB_DELAY_MS}ms, forceRefresh=${FORCE_WIKIDATA_REFRESH ? 'yes' : 'no'}.`,
  );

  for (const [clubIndex, club] of selectedClubs.entries()) {
    try {
      const finalCachePath = clubCachePath(club);
      const partialCachePath = clubCachePath(club, true);
      const cachedClub = FORCE_WIKIDATA_REFRESH ? undefined : await readClubCache(finalCachePath);

      if (cacheMatchesCurrentSelection(cachedClub)) {
        cachedClub.players.forEach((player) => {
          mergePlayerIntoMap(player, players);
          detailCache.set(player.id, detailFromRawPlayer(player));
        });
        console.log(
          `Using cached ${club.clubName} data: ${cachedClub.playersWithDatedClubHistory} players with dated club history.`,
        );
        selectedPlayersByClub[club.clubId] = cachedClub.selectedPlayerIds?.length ?? cachedClub.players.length;
        selectedPlayersByClubEra[club.clubId] = cachedClub.selectedPlayersByEra ?? {};
        continue;
      }

      if (cachedClub?.complete) {
        console.log(
          `${club.clubName} cache exists but will be expanded for current era/player limits (${TARGET_ERAS.join(', ')}, max ${MAX_PLAYERS_PER_CLUB}).`,
        );
      }

      const partialCache = FORCE_WIKIDATA_REFRESH
        ? undefined
        : richerCache(await readClubCache(partialCachePath), cachedClub);
      const clubWarnings = [...(partialCache?.warnings ?? [])];
      const skippedBatches = [...(partialCache?.skippedBatches ?? [])];
      let spellRows = partialCache?.spellRows ?? [];

      if (partialCache?.details.length) {
        partialCache.details.forEach((detail) => {
          detailCache.set(detail.id, detail);
        });
      }

      if (spellRows.length > 0) {
        const selected = selectRepresentativePlayers(spellRows, detailCache, localNameKeys);
        const cachedPlayerIds = selected.selectedPlayerIds;
        const totalBatches = chunks(cachedPlayerIds, entityBatchSize).length;
        const firstIncompleteBatch = chunks(cachedPlayerIds, entityBatchSize).findIndex((batch) =>
          batch.some((playerId) => !detailCache.has(playerId)),
        );
        const resumeBatch = firstIncompleteBatch === -1 ? totalBatches : firstIncompleteBatch + 1;
        console.log(`Resuming ${club.clubName} from batch ${resumeBatch}/${totalBatches}.`);
      } else {
        console.log(`Fetching ${club.clubName} basic spells...`);
        const rows = await runSparqlWithRetry(clubSpellsQuery(club, limit), `${club.clubName} basic spells`);
        spellRows = rows.flatMap((row) => spellRowFromBinding(row) ?? []);
        console.log(`${club.clubName} basic spells: ${spellRows.length} rows.`);

        if (spellRows.length === 0) {
          const warning = `No Wikidata rows returned for ${club.clubName} (${club.wikidataQid}).`;
          clubWarnings.push(warning);
          console.warn(warning);
        }
      }

      const rawPlayerIds = unique(spellRows.map((row) => row.playerId));
      const selected = selectRepresentativePlayers(spellRows, detailCache, localNameKeys);
      const playerIds = selected.selectedPlayerIds;
      console.log(`${club.clubName} unique players: ${rawPlayerIds.length}.`);
      console.log(`${club.clubName} selected players for details: ${playerIds.length} / ${rawPlayerIds.length}.`);
      console.log(`${club.clubName} selected by era:`);
      TARGET_ERAS.forEach((era) => {
        console.log(`${era}: ${selected.selectedByEra[era]}`);
      });
      selectedPlayersByClub[club.clubId] = playerIds.length;
      selectedPlayersByClubEra[club.clubId] = selected.selectedByEra;

      const savePartial = async () => {
        await writeClubCache(
          partialCachePath,
          cacheFromClubState({
            club,
            complete: false,
            batchSize: entityBatchSize,
            playerIds,
            selectedByEra: selected.selectedByEra,
            spellRows,
            detailCache,
            skippedBatches: unique(skippedBatches),
            warnings: unique(clubWarnings),
          }),
        );
      };

      await savePartial();
      await fetchMissingDetails(
        club,
        playerIds,
        detailCache,
        labelCache,
        entityBatchSize,
        clubWarnings,
        skippedBatches,
        savePartial,
      );

      const clubPlayersMap = new Map<string, RawPlayerRecord>();
      collectClubRows(club, spellRows, detailCache, clubPlayersMap);
      const clubPlayers = [...clubPlayersMap.values()].sort((a, b) => a.id.localeCompare(b.id));
      const datedPlayerCount = countDatedPlayersFromRecords(clubPlayers);
      clubPlayers.forEach((player) => {
        mergePlayerIntoMap(player, players);
        detailCache.set(player.id, detailFromRawPlayer(player));
      });

      await writeClubCache(
        finalCachePath,
        cacheFromClubState({
          club,
          complete: true,
          batchSize: entityBatchSize,
          playerIds,
          selectedByEra: selected.selectedByEra,
          spellRows,
          detailCache,
          players: clubPlayers,
          skippedBatches: unique(skippedBatches),
          warnings: unique(clubWarnings),
        }),
      );
      warnings.push(...clubWarnings);
      console.log(`${club.clubName} done: ${datedPlayerCount} players with dated club history.`);
      console.log(`Saved ${club.clubName} cache: ${finalCachePath}.`);

      if (clubIndex < selectedClubs.length - 1) {
        console.log(`Waiting ${Math.round(CLUB_DELAY_MS / 1000)}s before next club...`);
        await wait(CLUB_DELAY_MS);
      }
    } catch (error) {
      const warning = `Skipped ${club.clubName} (${club.wikidataQid}): ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      failedClubs.push(club.clubId);
      console.warn(warning);
    }
  }

  const sortedPlayers = [...players.values()].sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0));
  const datedClubSpellCount = sortedPlayers.reduce(
    (sum, player) => sum + player.clubs.filter((spell) => spell.fromYear).length,
    0,
  );

  const failedCriticalClubs = failedClubs.filter((clubId) => CRITICAL_CLUB_IDS.has(clubId));
  if (failedClubs.length > 0) {
    console.warn(`Failed clubs: ${failedClubs.join(', ')}`);
  } else {
    console.log('Failed clubs: none');
  }

  if (
    sortedPlayers.length === 0 ||
    datedClubSpellCount === 0 ||
    failedClubs.length === selectedClubs.length ||
    failedCriticalClubs.length >= 4
  ) {
    throw new Error(WIKIDATA_UNAVAILABLE_MESSAGE);
  }

  const output: RawPlayersFile = {
    generatedAt: new Date().toISOString(),
    source: 'Wikidata Query Service',
    clubs: selectedClubs,
    count: sortedPlayers.length,
    players: sortedPlayers,
    warnings,
    stats: {
      clubMode,
      playersWithDatedClubHistory: sortedPlayers.filter((player) => player.clubs.some((spell) => spell.fromYear)).length,
      selectedPlayersByClub,
      selectedPlayersByClubEra,
    },
  };

  await mkdir('data/raw', { recursive: true });
  await writeFile('data/raw/wikidata-players.next.json', `${JSON.stringify(output, null, 2)}\n`);
  await rename('data/raw/wikidata-players.next.json', 'data/raw/wikidata-players.json');
  console.log(
    `Wrote data/raw/wikidata-players.json with ${output.count} players and ${datedClubSpellCount} dated club spells.`,
  );
  console.log(
    JSON.stringify(
      {
        source: output.source,
        playersWithDatedClubHistory: output.stats?.playersWithDatedClubHistory,
        selectedPlayersByClub,
        selectedPlayersByClubEra,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  fetchWikidata().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
