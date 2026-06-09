import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Era, NormalizedPosition, Player, TeamEraTag } from '../src/types';
import type { NormalizedPlayersFile, RawClubSpell, RawPlayerRecord, RawPlayersFile } from './types';

const CURRENT_YEAR = new Date().getFullYear();
const ERAS: Era[] = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const execFileAsync = promisify(execFile);

type UnknownRecord = Record<string, unknown>;

interface LocalPlayerEnhancement {
  localId?: string;
  names: string[];
  cnName?: string;
  birthYear?: number;
  rawPositions: string[];
  normalizedPositions: NormalizedPosition[];
}

interface LocalEnhancementIndex {
  count: number;
  byName: Map<string, LocalPlayerEnhancement[]>;
  byNameBirthYear: Map<string, LocalPlayerEnhancement[]>;
}

function parseYear(date?: string): number | undefined {
  if (!date) return undefined;
  const match = date.match(/^(-?\d{1,4})-/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1870 && year <= 2035 ? year : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstString(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function parseBirthYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1870 && value <= 2035) return value;
  const text = stringValue(value);
  if (!text) return undefined;
  const isoMatch = text.match(/^(-?\d{4})-/);
  const yearMatch = isoMatch ?? text.match(/(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/);
  if (!yearMatch) return undefined;
  const year = Number(yearMatch[1]);
  return year >= 1870 && year <= 2035 ? year : undefined;
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

function extractStringItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(extractStringItems);
  const text = stringValue(value);
  if (!text) return [];
  return text
    .split(/[,/|;、，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function eraRange(era: Era) {
  const start = Number(era.slice(0, 4));
  return { start, end: start + 9 };
}

function normalizePositionLabel(label: string): NormalizedPosition[] {
  const raw = label.trim();
  const code = raw.toUpperCase();
  const codeMap: Partial<Record<string, NormalizedPosition[]>> = {
    GK: ['GK'],
    LB: ['LB'],
    CB: ['CB'],
    RB: ['RB'],
    LWB: ['LWB'],
    RWB: ['RWB'],
    CDM: ['CDM'],
    CM: ['CM'],
    CAM: ['CAM'],
    LM: ['LM'],
    RM: ['RM'],
    LW: ['LF'],
    LF: ['LF'],
    RW: ['RF'],
    RF: ['RF'],
    CF: ['ST'],
    ST: ['ST'],
    SW: ['CB'],
  };
  if (codeMap[code]) return codeMap[code]!;

  const zhMap: Record<string, NormalizedPosition[]> = {
    门将: ['GK'],
    守门员: ['GK'],
    中后卫: ['CB'],
    后卫: ['CB'],
    左后卫: ['LB'],
    右后卫: ['RB'],
    左翼卫: ['LWB'],
    右翼卫: ['RWB'],
    后腰: ['CDM'],
    中场: ['CM'],
    中前卫: ['CM'],
    前腰: ['CAM'],
    左前卫: ['LM'],
    右前卫: ['RM'],
    左边锋: ['LF'],
    左前锋: ['LF'],
    右边锋: ['RF'],
    右前锋: ['RF'],
    前锋: ['ST'],
    中锋: ['ST'],
  };
  if (zhMap[raw]) return zhMap[raw];

  const value = raw.toLowerCase().replace(/-/g, ' ');
  const output: NormalizedPosition[] = [];

  if (value.includes('goalkeeper')) output.push('GK');
  if (value.includes('left wing back')) output.push('LWB');
  if (value.includes('right wing back')) output.push('RWB');
  if (value.includes('left back')) output.push('LB');
  if (value.includes('right back')) output.push('RB');
  if (value.includes('centre back') || value.includes('center back') || value.includes('central defender')) output.push('CB');
  if (value.includes('defensive midfielder')) output.push('CDM');
  if (value.includes('central midfielder') || value === 'midfielder' || value.includes('association football midfielder')) output.push('CM');
  if (value.includes('attacking midfielder')) output.push('CAM');
  if (value.includes('left midfielder')) output.push('LM');
  if (value.includes('right midfielder')) output.push('RM');
  if (value.includes('left winger') || value.includes('left forward')) output.push('LF');
  if (value.includes('right winger') || value.includes('right forward')) output.push('RF');
  if (value.includes('striker') || value.includes('centre forward') || value.includes('center forward')) output.push('ST');
  if (value.includes('forward') && !value.includes('left') && !value.includes('right')) output.push('ST');
  if (value.includes('defender') && output.length === 0) output.push('CB');

  return output;
}

function normalizePositions(labels: string[]): NormalizedPosition[] {
  const positions = labels.flatMap(normalizePositionLabel);
  return unique(positions);
}

function localDataPaths(filename: string): string[] {
  const paths = new Set<string>();
  const explicitPlayersJson = process.env.LSK_LOCAL_PLAYERS_JSON;
  const explicitPositionsJson = process.env.LSK_LOCAL_POSITIONS_JSON;
  const localDir = process.env.LSK_LOCAL_DATA_DIR;

  if (filename === 'players_all.json' && explicitPlayersJson) paths.add(explicitPlayersJson);
  if (filename === 'player_positions.json' && explicitPositionsJson) paths.add(explicitPositionsJson);
  if (localDir) paths.add(`${localDir}/${filename}`);

  paths.add(`data/local/${filename}`);
  paths.add(`data/raw/${filename}`);
  paths.add(`/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/${filename}`);
  paths.add(`/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/generated/${filename}`);
  return [...paths];
}

function localSqlitePaths(): string[] {
  const paths = new Set<string>();
  const explicitSqlite = process.env.LSK_LOCAL_SQLITE;
  const localDir = process.env.LSK_LOCAL_DATA_DIR;
  if (explicitSqlite) paths.add(explicitSqlite);
  if (localDir) paths.add(`${localDir}/players.sqlite`);
  paths.add('data/local/players.sqlite');
  paths.add('/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/players.sqlite');
  return [...paths];
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const filePath of paths) {
    try {
      const result = await stat(filePath);
      if (result.isFile()) return filePath;
    } catch {
      // Optional local enhancement input.
    }
  }
  return undefined;
}

async function readOptionalJsonArray(paths: string[]): Promise<UnknownRecord[]> {
  for (const filePath of paths) {
    try {
      const json = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      const items = Array.isArray(json)
        ? json
        : isRecord(json) && Array.isArray(json.players)
          ? json.players
          : isRecord(json) && Array.isArray(json.data)
            ? json.data
            : isRecord(json) && Array.isArray(json.items)
              ? json.items
              : [];
      return items.filter(isRecord);
    } catch (error) {
      const code = isRecord(error) ? stringValue(error.code) : undefined;
      if (code !== 'ENOENT') {
        console.warn(`Skipped optional LSK local data file ${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  return [];
}

async function readOptionalSqliteRows(tableName: 'players' | 'player_positions'): Promise<UnknownRecord[]> {
  const sqlitePath = await firstExistingPath(localSqlitePaths());
  if (!sqlitePath) return [];

  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', sqlitePath, `SELECT * FROM ${tableName};`], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout || '[]') as unknown;
    return Array.isArray(rows) ? rows.filter(isRecord) : [];
  } catch (error) {
    console.warn(
      `Skipped optional LSK sqlite table ${tableName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function localIdFor(record: UnknownRecord): string | undefined {
  return firstString(record, ['playerId', 'player_id', 'pid', 'id', 'spid', 'nexonId', 'nexon_id']);
}

function localNamesFor(record: UnknownRecord): string[] {
  return unique(
    [
      firstString(record, ['name', 'playerName', 'player_name', 'displayName', 'display_name', 'fullName', 'full_name']),
      firstString(record, ['enName', 'nameEn', 'name_en', 'englishName', 'playerNameEn', 'player_name_en']),
      firstString(record, ['cnName', 'nameCn', 'name_cn', 'zhName', 'name_zh', 'chineseName', 'playerNameCn']),
    ].filter((value): value is string => Boolean(value)),
  );
}

function localCnNameFor(record: UnknownRecord): string | undefined {
  return firstString(record, ['cnName', 'nameCn', 'name_cn', 'zhName', 'name_zh', 'chineseName', 'playerNameCn']);
}

function localPositionLabelsFor(record: UnknownRecord): string[] {
  return unique(
    [
      ...extractStringItems(record.positions),
      ...extractStringItems(record.normalizedPositions),
      ...extractStringItems(record.position),
      ...extractStringItems(record.mainPosition),
      ...extractStringItems(record.positionName),
      ...extractStringItems(record.position_code),
      ...extractStringItems(record.position_name),
      ...extractStringItems(record.positionCode),
      ...extractStringItems(record.pos),
    ].filter(Boolean),
  );
}

function localBirthYearFor(record: UnknownRecord): number | undefined {
  return (
    parseBirthYear(record.birthYear) ??
    parseBirthYear(record.birth_year) ??
    parseBirthYear(record.birthDate) ??
    parseBirthYear(record.birthday) ??
    parseBirthYear(record.dateOfBirth) ??
    parseBirthYear(record.date_of_birth)
  );
}

function mergeEnhancement(base: LocalPlayerEnhancement, next: LocalPlayerEnhancement): LocalPlayerEnhancement {
  const rawPositions = unique([...base.rawPositions, ...next.rawPositions]);
  return {
    localId: base.localId ?? next.localId,
    names: unique([...base.names, ...next.names]),
    cnName: base.cnName ?? next.cnName,
    birthYear: base.birthYear ?? next.birthYear,
    rawPositions,
    normalizedPositions: unique([...base.normalizedPositions, ...next.normalizedPositions]),
  };
}

function enhancementFromRecord(record: UnknownRecord): LocalPlayerEnhancement | undefined {
  const names = localNamesFor(record);
  const rawPositions = localPositionLabelsFor(record);
  if (names.length === 0 && rawPositions.length === 0) return undefined;
  return {
    localId: localIdFor(record),
    names,
    cnName: localCnNameFor(record),
    birthYear: localBirthYearFor(record),
    rawPositions,
    normalizedPositions: normalizePositions(rawPositions),
  };
}

function indexEnhancement(
  target: Map<string, LocalPlayerEnhancement>,
  enhancement: LocalPlayerEnhancement | undefined,
) {
  if (!enhancement) return;
  const nameKeys = enhancement.names.map(normalizeNameKey).filter((value): value is string => Boolean(value));
  const key = enhancement.localId ?? nameKeys[0];
  if (!key) return;
  const existing = target.get(key);
  target.set(key, existing ? mergeEnhancement(existing, enhancement) : enhancement);
}

function pushIndexEntry(index: Map<string, LocalPlayerEnhancement[]>, key: string | undefined, item: LocalPlayerEnhancement) {
  if (!key) return;
  index.set(key, [...(index.get(key) ?? []), item]);
}

async function buildLocalEnhancementIndex(): Promise<LocalEnhancementIndex> {
  const playerRows = [
    ...(await readOptionalJsonArray(localDataPaths('players_all.json'))),
    ...(await readOptionalSqliteRows('players')),
  ];
  const positionRows = [
    ...(await readOptionalJsonArray(localDataPaths('player_positions.json'))),
    ...(await readOptionalSqliteRows('player_positions')),
  ];
  const byLocalId = new Map<string, LocalPlayerEnhancement>();

  playerRows.forEach((record) => {
    indexEnhancement(byLocalId, enhancementFromRecord(record));
  });

  positionRows.forEach((record) => {
    const enhancement = enhancementFromRecord(record);
    if (!enhancement) return;
    indexEnhancement(byLocalId, enhancement);
  });

  const entries = [...byLocalId.values()].filter(
    (entry) => entry.names.length > 0 && (entry.rawPositions.length > 0 || entry.cnName),
  );
  const byName = new Map<string, LocalPlayerEnhancement[]>();
  const byNameBirthYear = new Map<string, LocalPlayerEnhancement[]>();

  entries.forEach((entry) => {
    entry.names.forEach((name) => {
      const nameKey = normalizeNameKey(name);
      pushIndexEntry(byName, nameKey, entry);
      if (nameKey && entry.birthYear) pushIndexEntry(byNameBirthYear, `${nameKey}|${entry.birthYear}`, entry);
    });
  });

  if (entries.length > 0) {
    console.log(`Loaded ${entries.length} optional LSK local player enhancement records.`);
  }

  return {
    count: entries.length,
    byName,
    byNameBirthYear,
  };
}

function combineLocalMatches(matches: LocalPlayerEnhancement[]): LocalPlayerEnhancement | undefined {
  return matches.reduce<LocalPlayerEnhancement | undefined>(
    (merged, item) => (merged ? mergeEnhancement(merged, item) : item),
    undefined,
  );
}

function findLocalEnhancement(player: Player, index: LocalEnhancementIndex): LocalPlayerEnhancement | undefined {
  const names = unique([player.name, player.cnName, player.displayName].filter((value): value is string => Boolean(value)));
  if (player.birthYear) {
    for (const name of names) {
      const key = normalizeNameKey(name);
      if (!key) continue;
      const exactMatches = index.byNameBirthYear.get(`${key}|${player.birthYear}`) ?? [];
      if (exactMatches.length > 0) return combineLocalMatches(exactMatches);
    }
  }

  for (const name of names) {
    const key = normalizeNameKey(name);
    if (!key) continue;
    const matches = index.byName.get(key) ?? [];
    if (matches.length === 1) return matches[0];
    const sameBirthYear = matches.filter((match) => match.birthYear && match.birthYear === player.birthYear);
    if (sameBirthYear.length > 0) return combineLocalMatches(sameBirthYear);
  }

  return undefined;
}

function enhanceWithLocalData(player: Player, index: LocalEnhancementIndex): { player: Player; matched: boolean } {
  if (index.count === 0) return { player, matched: false };
  const local = findLocalEnhancement(player, index);
  if (!local) return { player, matched: false };

  const positions = unique([...player.positions, ...local.rawPositions]);
  const normalizedPositions = unique([...player.normalizedPositions, ...local.normalizedPositions]);
  const cnName = player.cnName ?? local.cnName;
  const confidence =
    player.normalizedPositions.length === 0 && local.normalizedPositions.length > 0
      ? clamp(player.confidence + 15, 0, 100)
      : player.confidence;

  return {
    matched: true,
    player: {
      ...player,
      cnName,
      displayName: cnName ?? player.displayName,
      positions,
      normalizedPositions,
      confidence,
    },
  };
}

function spellEndYear(spell: RawClubSpell, confidencePenalty: { value: number }) {
  if (spell.toYear) return spell.toYear;
  if (!spell.fromYear) return undefined;

  if (spell.fromYear >= CURRENT_YEAR - 4) {
    return CURRENT_YEAR;
  }

  confidencePenalty.value += 12;
  return Math.min(spell.fromYear + 2, CURRENT_YEAR);
}

function buildTeamEraTags(spell: RawClubSpell, confidencePenalty: { value: number }): TeamEraTag[] {
  if (!spell.fromYear) {
    confidencePenalty.value += 18;
    return [];
  }

  const toYear = spellEndYear(spell, confidencePenalty);
  if (!toYear || toYear < spell.fromYear) return [];

  return ERAS.flatMap((era) => {
    const range = eraRange(era);
    const fromYear = Math.max(spell.fromYear!, range.start);
    const endYear = Math.min(toYear, range.end);
    if (fromYear > endYear) return [];

    const yearsInEra = endYear - fromYear + 1;
    return {
      clubId: spell.clubId,
      clubName: spell.clubName,
      clubCnName: spell.clubCnName,
      era,
      fromYear,
      toYear: endYear,
      yearsInEra,
      weight: clamp(yearsInEra / 10, 0.1, 1),
    };
  });
}

function confidenceFor(player: RawPlayerRecord, normalizedPositions: NormalizedPosition[], tags: TeamEraTag[], penalty: number) {
  let score = 45;
  if (player.name) score += 8;
  if (player.cnName) score += 5;
  if (player.nationality) score += 10;
  if (player.birthDate) score += 8;
  if (normalizedPositions.length > 0) score += 15;
  if (player.clubs.some((spell) => spell.fromYear)) score += 10;
  if (tags.length > 0) score += 12;
  if ((player.sitelinks ?? 0) >= 20) score += 5;
  return clamp(score - penalty, 0, 100);
}

function baseRating(player: RawPlayerRecord, confidence: number) {
  const sitelinks = player.sitelinks ?? 0;
  const sitelinkBonus = Math.min(10, Math.floor(Math.log10(sitelinks + 1) * 4));
  const clubBonus = Math.min(3, Math.max(0, player.clubs.length - 1));
  return clamp(70 + sitelinkBonus + Math.floor((confidence - 60) / 8) + clubBonus + (player.cnName ? 1 : 0), 70, 94);
}

function normalizePlayer(player: RawPlayerRecord): Player {
  const normalizedPositions = normalizePositions(player.positions);
  const penalty = { value: 0 };
  const teamEraTags = player.clubs.flatMap((spell) => buildTeamEraTags(spell, penalty));
  const confidence = confidenceFor(player, normalizedPositions, teamEraTags, penalty.value);
  const birthYear = parseYear(player.birthDate);

  return {
    id: player.id,
    name: player.name ?? player.id,
    cnName: player.cnName,
    displayName: player.cnName ?? player.name ?? player.id,
    nationality: player.nationality,
    birthYear,
    positions: unique(player.positions),
    normalizedPositions,
    clubs: player.clubs.map((spell) => ({
      clubId: spell.clubId,
      clubName: spell.clubName,
      clubCnName: spell.clubCnName,
      fromYear: spell.fromYear,
      toYear: spell.toYear,
    })),
    teamEraTags,
    rating: baseRating(player, confidence),
    confidence,
    sitelinks: player.sitelinks,
  };
}

export async function normalizePlayers() {
  const raw = JSON.parse(await readFile('data/raw/wikidata-players.json', 'utf8')) as RawPlayersFile;
  const localIndex = await buildLocalEnhancementIndex();
  let lskLocalMatchedPlayers = 0;
  const players = raw.players
    .map((rawPlayer) => enhanceWithLocalData(normalizePlayer(rawPlayer), localIndex))
    .map((result) => {
      if (result.matched) lskLocalMatchedPlayers += 1;
      return result.player;
    })
    .sort((a, b) => b.rating - a.rating || b.confidence - a.confidence || a.displayName.localeCompare(b.displayName));

  const output: NormalizedPlayersFile = {
    generatedAt: new Date().toISOString(),
    source: lskLocalMatchedPlayers > 0 ? 'wikidata+lsk-local' : 'wikidata',
    count: players.length,
    players,
    stats: {
      clubMode: raw.stats?.clubMode,
      totalClubSpells: players.reduce((sum, player) => sum + player.clubs.length, 0),
      totalTeamEraTags: players.reduce((sum, player) => sum + player.teamEraTags.length, 0),
      playersWithDatedClubHistory: players.filter((player) => player.teamEraTags.length > 0).length,
      lskLocalMatchedPlayers,
      lowConfidencePlayers: players.filter((player) => player.confidence < 60).length,
    },
  };

  await mkdir('data/generated', { recursive: true });
  const json = `${JSON.stringify(output, null, 2)}\n`;
  await writeFile('data/generated/players.json', json);
  if (process.env.WRITE_PUBLIC === '1') {
    await mkdir('public/data', { recursive: true });
    await writeFile('public/data/players.json', json);
  }
  console.log(`Wrote ${players.length} normalized players.`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  normalizePlayers().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
