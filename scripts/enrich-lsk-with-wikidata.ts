import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Era, NormalizedPosition, Player, TeamEraTag } from '../src/types';

type UnknownRecord = Record<string, unknown>;
type MatchLevel = 'autoMatch' | 'probableMatch' | 'weakMatch' | 'noMatch';
type NameSource =
  | 'lsk-local'
  | 'wikidata-zh-hans'
  | 'wikidata-zh-cn'
  | 'wikidata-zh-converted'
  | 'wikidata-zh-hant-converted'
  | 'wikidata-en'
  | 'qid';

interface LocalPlayer {
  lskPlayerId: string;
  lskName: string;
  lskEnglishName?: string;
  cnName?: string;
  names: string[];
  aliases: string[];
  birthYear?: number;
  nationality?: string;
  sourcePositions: string[];
  normalizedPositions: NormalizedPosition[];
  sourceTeams: string[];
  sourceFiles: string[];
}

interface WikidataPlayer {
  id: string;
  name?: string;
  cnName?: string;
  displayName: string;
  nationality?: string;
  birthYear?: number;
  positions: string[];
  normalizedPositions: NormalizedPosition[];
  clubs: Array<{
    clubId: string;
    clubName: string;
    clubCnName?: string;
    fromYear?: number;
    toYear?: number;
  }>;
  teamEraTags: TeamEraTag[];
}

interface CandidateMatch {
  player: WikidataPlayer;
  score: number;
  reasons: string[];
}

interface LinkRecord {
  lskPlayerId: string;
  lskName: string;
  lskEnglishName: string;
  wikidataQid: string;
  wikidataName: string;
  matchConfidence: number;
  matchLevel: MatchLevel;
  matchReasons: string[];
  ambiguousCandidates: Array<{
    wikidataQid: string;
    wikidataName: string;
    matchConfidence: number;
    matchReasons: string[];
  }>;
}

const execFileAsync = promisify(execFile);
const OUTPUT_DIR = 'data/enriched';
const ERAS: Era[] = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const POSITIONS: NormalizedPosition[] = [
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

const MANUAL_ALIAS_GROUPS = [
  ['Cristiano Ronaldo', 'Cristiano Ronaldo dos Santos Aveiro', 'C罗', '克里斯蒂亚诺·罗纳尔多', '罗纳尔多'],
  ['Lionel Messi', 'Leo Messi', 'Messi', '梅西', '利昂内尔·梅西'],
  ['Kaká', 'Kaka', '卡卡'],
  ['David Beckham', 'Beckham', '贝克汉姆'],
  ['Sergio Ramos', 'Ramos', '拉莫斯', '塞尔吉奥·拉莫斯'],
  ['Neymar', 'Neymar Jr', 'Neymar Junior', '内马尔'],
];

const TRADITIONAL_PHRASES: Record<string, string> = {
  貝克漢姆: '贝克汉姆',
  羅納爾多: '罗纳尔多',
  馬爾蒂尼: '马尔蒂尼',
  齊達內: '齐达内',
  內馬爾: '内马尔',
  謝甫琴科: '舍甫琴科',
  勞爾: '劳尔',
  羅伯托: '罗伯托',
};

const TRADITIONAL_CHARS: Record<string, string> = {
  貝: '贝',
  漢: '汉',
  羅: '罗',
  納: '纳',
  爾: '尔',
  馬: '马',
  蒂: '蒂',
  齊: '齐',
  達: '达',
  內: '内',
  謝: '谢',
  甫: '甫',
  琴: '琴',
  科: '科',
  勞: '劳',
  魯: '鲁',
  斯: '斯',
  約: '约',
  維: '维',
  奇: '奇',
  亞: '亚',
  盧: '卢',
  卡: '卡',
  莫: '莫',
  德: '德',
  裡: '里',
  裏: '里',
  優: '优',
  東: '东',
  蘭: '兰',
  國: '国',
  門: '门',
  將: '将',
  後: '后',
  衛: '卫',
  場: '场',
  鋒: '锋',
  邊: '边',
  隊: '队',
  聯: '联',
  聖: '圣',
  蘇: '苏',
  迪: '迪',
  歐: '欧',
  陽: '阳',
  義: '义',
  龍: '龙',
};

const COUNTRY_ALIASES: Record<string, string> = {
  argentina: 'argentina',
  阿根廷: 'argentina',
  brazil: 'brazil',
  brasil: 'brazil',
  巴西: 'brazil',
  portugal: 'portugal',
  葡萄牙: 'portugal',
  spain: 'spain',
  西班牙: 'spain',
  france: 'france',
  法国: 'france',
  法國: 'france',
  germany: 'germany',
  德国: 'germany',
  德國: 'germany',
  italy: 'italy',
  意大利: 'italy',
  england: 'england',
  英格兰: 'england',
  英格蘭: 'england',
  netherlands: 'netherlands',
  holland: 'netherlands',
  荷兰: 'netherlands',
  荷蘭: 'netherlands',
  uruguay: 'uruguay',
  乌拉圭: 'uruguay',
  烏拉圭: 'uruguay',
  croatia: 'croatia',
  克罗地亚: 'croatia',
  克羅地亞: 'croatia',
  belgium: 'belgium',
  比利时: 'belgium',
  比利時: 'belgium',
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}

function parseYear(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric && numeric >= 1870 && numeric <= 2035) return Math.trunc(numeric);
  const text = stringValue(value);
  if (!text) return undefined;
  const iso = text.match(/^(-?\d{4})-/);
  const dotted = text.match(/\b(\d{1,2})\.(\d{1,2})\.(19\d{2}|20\d{2})\b/);
  const loose = text.match(/\b(19\d{2}|20\d{2})\b/);
  const year = Number(iso?.[1] ?? dotted?.[3] ?? loose?.[1]);
  return year >= 1870 && year <= 2035 ? year : undefined;
}

function simplifyChinese(input?: string): string | undefined {
  if (!input) return undefined;
  let output = input;
  for (const [traditional, simplified] of Object.entries(TRADITIONAL_PHRASES)) {
    output = output.split(traditional).join(simplified);
  }
  output = [...output].map((char) => TRADITIONAL_CHARS[char] ?? char).join('');
  return output.trim() || undefined;
}

function hasChinese(input?: string): boolean {
  return Boolean(input && /[\u3400-\u9fff]/.test(input));
}

function normalizeNameKey(name?: string): string | undefined {
  const simplified = simplifyChinese(name);
  if (!simplified) return undefined;
  const key = simplified
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/jr\.?/g, 'junior')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return key || undefined;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.flatMap(parseStringList));
  if (isRecord(value)) return [];
  const text = stringValue(value);
  if (!text) return [];
  const trimmed = text.trim();
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parseStringList(parsed);
    } catch {
      // Fall through to delimiter parsing.
    }
  }
  return unique(trimmed.split(/[,/|;、，]+/).map((item) => item.trim()).filter(Boolean));
}

function firstString(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeCountry(value?: string): string | undefined {
  const simplified = simplifyChinese(value);
  const key = normalizeNameKey(simplified);
  if (!key) return undefined;
  return COUNTRY_ALIASES[key] ?? key;
}

function normalizePositionLabel(label: string): NormalizedPosition[] {
  const raw = simplifyChinese(label)?.trim();
  if (!raw) return [];
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
  return unique(output);
}

function normalizePositions(labels: string[]): NormalizedPosition[] {
  return unique(labels.flatMap(normalizePositionLabel)).filter((position): position is NormalizedPosition =>
    POSITIONS.includes(position),
  );
}

function aliasNamesFor(names: string[]): string[] {
  const keys = new Set(names.map(normalizeNameKey).filter(Boolean));
  const aliases = new Set<string>();
  MANUAL_ALIAS_GROUPS.forEach((group) => {
    if (group.some((name) => keys.has(normalizeNameKey(name)))) {
      group.forEach((name) => aliases.add(name));
    }
  });
  return [...aliases];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const result = await stat(filePath);
    return result.isFile();
  } catch {
    return false;
  }
}

function localJsonPaths(filename: string): string[] {
  const paths = new Set<string>();
  if (filename === 'players_all.json' && process.env.LSK_LOCAL_PLAYERS_JSON) paths.add(process.env.LSK_LOCAL_PLAYERS_JSON);
  if (filename === 'player_positions.json' && process.env.LSK_LOCAL_POSITIONS_JSON) paths.add(process.env.LSK_LOCAL_POSITIONS_JSON);
  paths.add(`data/local/${filename}`);
  paths.add(`data/raw/${filename}`);
  paths.add(`/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/${filename}`);
  return [...paths];
}

function sqlitePaths(): string[] {
  const paths = new Set<string>();
  if (process.env.LSK_LOCAL_SQLITE) paths.add(process.env.LSK_LOCAL_SQLITE);
  paths.add('data/local/players.sqlite');
  paths.add('data/raw/players.sqlite');
  paths.add('/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/players.sqlite');
  return [...paths];
}

async function readJsonRecords(paths: string[], sourceFiles: Set<string>): Promise<UnknownRecord[]> {
  for (const filePath of paths) {
    if (!(await exists(filePath))) continue;
    try {
      const json = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      const rows = Array.isArray(json)
        ? json
        : isRecord(json) && Array.isArray(json.players)
          ? json.players
          : isRecord(json) && Array.isArray(json.data)
            ? json.data
            : isRecord(json) && Array.isArray(json.items)
              ? json.items
              : [];
      sourceFiles.add(filePath);
      return rows.filter(isRecord);
    } catch (error) {
      console.warn(`Skipped optional local JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return [];
}

async function firstExistingSqlite(sourceFiles: Set<string>): Promise<string | undefined> {
  for (const filePath of sqlitePaths()) {
    if (await exists(filePath)) {
      sourceFiles.add(filePath);
      return filePath;
    }
  }
  return undefined;
}

async function readSqliteRows(sqlitePath: string | undefined, tableName: string, columns: string[]): Promise<UnknownRecord[]> {
  if (!sqlitePath) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', sqlitePath, `SELECT ${columns.join(', ')} FROM ${tableName};`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch (error) {
    console.warn(`Skipped optional sqlite table ${tableName}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function localIdFor(record: UnknownRecord): string | undefined {
  return firstString(record, ['identity_id', 'lskPlayerId', 'playerId', 'player_id', 'pid', 'id', 'uid', 'fo4pid']);
}

function extractLocalNames(record: UnknownRecord): string[] {
  return unique([
    firstString(record, ['display_name', 'displayName', 'name', 'playerName', 'fullName', 'normalized_name']),
    firstString(record, ['englishName', 'enName', 'nameEn', 'name_en']),
    firstString(record, ['cnName', 'nameCn', 'zhName', 'chineseName']),
    ...parseStringList(record.known_names),
    ...parseStringList(record.aliases),
  ].filter((value): value is string => Boolean(value)));
}

function extractLocalPositions(record: UnknownRecord): string[] {
  return unique([
    ...parseStringList(record.positions),
    ...parseStringList(record.normalizedPositions),
    ...parseStringList(record.position),
    ...parseStringList(record.mainPosition),
    ...parseStringList(record.pos),
  ]);
}

function localFromRecord(record: UnknownRecord, sourceFile: string): LocalPlayer | undefined {
  const names = extractLocalNames(record);
  const sourcePositions = extractLocalPositions(record);
  if (names.length === 0 && sourcePositions.length === 0) return undefined;

  const cnNames = names.filter(hasChinese).map((name) => simplifyChinese(name)).filter((name): name is string => Boolean(name));
  const englishNames = names.filter((name) => !hasChinese(name));
  const lskName = cnNames[0] ?? names[0] ?? localIdFor(record) ?? 'unknown';
  const lskEnglishName = englishNames[0];
  const birthYear =
    parseYear(record.birthYear) ??
    parseYear(record.birth_year) ??
    parseYear(record.birthDate) ??
    parseYear(record.birth_date) ??
    parseYear(record.birthday);
  const nationality = firstString(record, ['nationality', 'country']);
  const sourceTeams = unique([firstString(record, ['team', 'teamName', 'clubName'])].filter((value): value is string => Boolean(value)));
  const idSeed = normalizeNameKey(lskEnglishName ?? lskName) ?? localIdFor(record) ?? `local-${Math.random().toString(36).slice(2)}`;

  return {
    lskPlayerId: localIdFor(record) ?? `lsk:${idSeed}:${birthYear ?? 'unknown'}`,
    lskName,
    lskEnglishName,
    cnName: cnNames[0],
    names: unique([...names.map((name) => simplifyChinese(name) ?? name), ...aliasNamesFor(names)]),
    aliases: unique([...parseStringList(record.aliases), ...parseStringList(record.known_names), ...aliasNamesFor(names)]),
    birthYear,
    nationality,
    sourcePositions,
    normalizedPositions: normalizePositions(sourcePositions),
    sourceTeams,
    sourceFiles: [sourceFile],
  };
}

function mergeLocalPlayer(base: LocalPlayer, next: LocalPlayer): LocalPlayer {
  const cnName = base.cnName ?? next.cnName;
  const lskEnglishName = base.lskEnglishName ?? next.lskEnglishName;
  return {
    lskPlayerId: base.lskPlayerId,
    lskName: cnName ?? base.lskName ?? next.lskName,
    lskEnglishName,
    cnName,
    names: unique([...base.names, ...next.names]),
    aliases: unique([...base.aliases, ...next.aliases]),
    birthYear: base.birthYear ?? next.birthYear,
    nationality: base.nationality ?? next.nationality,
    sourcePositions: unique([...base.sourcePositions, ...next.sourcePositions]),
    normalizedPositions: unique([...base.normalizedPositions, ...next.normalizedPositions]),
    sourceTeams: unique([...base.sourceTeams, ...next.sourceTeams]),
    sourceFiles: unique([...base.sourceFiles, ...next.sourceFiles]),
  };
}

async function loadLocalPlayers(): Promise<{ players: LocalPlayer[]; sources: string[] }> {
  const sourceFiles = new Set<string>();
  const byId = new Map<string, LocalPlayer>();

  const playerJsonRows = await readJsonRecords(localJsonPaths('players_all.json'), sourceFiles);
  playerJsonRows.forEach((record) => {
    const item = localFromRecord(record, 'players_all.json');
    if (!item) return;
    byId.set(item.lskPlayerId, byId.has(item.lskPlayerId) ? mergeLocalPlayer(byId.get(item.lskPlayerId)!, item) : item);
  });

  const positionJsonRows = await readJsonRecords(localJsonPaths('player_positions.json'), sourceFiles);
  positionJsonRows.forEach((record) => {
    const item = localFromRecord(record, 'player_positions.json');
    if (!item) return;
    byId.set(item.lskPlayerId, byId.has(item.lskPlayerId) ? mergeLocalPlayer(byId.get(item.lskPlayerId)!, item) : item);
  });

  const sqlitePath = await firstExistingSqlite(sourceFiles);
  const sqlitePlayers = await readSqliteRows(sqlitePath, 'players', [
    'player_id',
    'fo4pid',
    'uid',
    'name',
    'position',
    'team',
    'country',
    'nationality',
    'birth_date',
  ]);
  sqlitePlayers.forEach((record) => {
    const item = localFromRecord(record, sqlitePath ?? 'players.sqlite');
    if (!item) return;
    byId.set(item.lskPlayerId, byId.has(item.lskPlayerId) ? mergeLocalPlayer(byId.get(item.lskPlayerId)!, item) : item);
  });

  const sqlitePositions = await readSqliteRows(sqlitePath, 'player_positions', ['uid', 'position']);
  sqlitePositions.forEach((record) => {
    const item = localFromRecord(record, sqlitePath ?? 'player_positions');
    if (!item) return;
    byId.set(item.lskPlayerId, byId.has(item.lskPlayerId) ? mergeLocalPlayer(byId.get(item.lskPlayerId)!, item) : item);
  });

  const sqliteIdentities = await readSqliteRows(sqlitePath, 'player_identities', [
    'identity_id',
    'normalized_name',
    'display_name',
    'nationality',
    'birth_date',
    'known_names',
    'aliases',
  ]);
  sqliteIdentities.forEach((record) => {
    const item = localFromRecord(record, sqlitePath ?? 'player_identities');
    if (!item) return;
    byId.set(item.lskPlayerId, byId.has(item.lskPlayerId) ? mergeLocalPlayer(byId.get(item.lskPlayerId)!, item) : item);
  });

  const players = [...byId.values()].filter((player) => player.names.length > 0);
  return { players, sources: [...sourceFiles] };
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function playerFromAny(record: UnknownRecord): WikidataPlayer | undefined {
  const id = firstString(record, ['id', 'playerId', 'wikidataQid']);
  if (!id) return undefined;
  const name = firstString(record, ['name', 'englishName']);
  const cnName = simplifyChinese(firstString(record, ['cnName', 'zhName', 'displayName']));
  const positions = unique([...parseStringList(record.positions), ...parseStringList(record.originalPositions)]);
  const normalizedPositions = normalizePositions([...positions, ...parseStringList(record.normalizedPositions)]);
  const clubs = Array.isArray(record.clubs)
    ? record.clubs.filter(isRecord).map((club) => ({
        clubId: firstString(club, ['clubId', 'clubKey']) ?? '',
        clubName: firstString(club, ['clubName']) ?? '',
        clubCnName: firstString(club, ['clubCnName']),
        fromYear: parseYear(club.fromYear),
        toYear: parseYear(club.toYear),
      })).filter((club) => club.clubId)
    : [];
  const teamEraTags = Array.isArray(record.teamEraTags)
    ? record.teamEraTags.filter(isRecord).map((tag) => ({
        clubId: firstString(tag, ['clubId', 'clubKey']) ?? '',
        clubName: firstString(tag, ['clubName']) ?? '',
        clubCnName: firstString(tag, ['clubCnName']),
        era: firstString(tag, ['era']) as Era,
        fromYear: parseYear(tag.fromYear),
        toYear: parseYear(tag.toYear),
        yearsInEra: numberValue(tag.yearsInEra) ?? 0,
        weight: numberValue(tag.weight) ?? 0,
      })).filter((tag) => tag.clubId && ERAS.includes(tag.era))
    : [];

  return {
    id,
    name,
    cnName,
    displayName: simplifyChinese(firstString(record, ['displayName'])) ?? cnName ?? name ?? id,
    nationality: simplifyChinese(firstString(record, ['nationality'])),
    birthYear: parseYear(record.birthYear) ?? parseYear(record.birthDate),
    positions,
    normalizedPositions,
    clubs,
    teamEraTags,
  };
}

function mergeWikidataPlayer(base: WikidataPlayer, next: WikidataPlayer): WikidataPlayer {
  return {
    ...base,
    name: base.name ?? next.name,
    cnName: base.cnName ?? next.cnName,
    displayName: base.displayName !== base.id ? base.displayName : next.displayName,
    nationality: base.nationality ?? next.nationality,
    birthYear: base.birthYear ?? next.birthYear,
    positions: unique([...base.positions, ...next.positions]),
    normalizedPositions: unique([...base.normalizedPositions, ...next.normalizedPositions]),
    clubs: uniqueByKey([...base.clubs, ...next.clubs], (club) => `${club.clubId}:${club.fromYear ?? ''}:${club.toYear ?? ''}`),
    teamEraTags: uniqueByKey([...base.teamEraTags, ...next.teamEraTags], (tag) => `${tag.clubId}:${tag.era}:${tag.fromYear ?? ''}:${tag.toYear ?? ''}`),
  };
}

function uniqueByKey<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadWikidataPlayers(): Promise<{ players: WikidataPlayer[]; sources: string[] }> {
  const sources: string[] = [];
  const byId = new Map<string, WikidataPlayer>();
  const addPlayer = (player: WikidataPlayer | undefined) => {
    if (!player) return;
    byId.set(player.id, byId.has(player.id) ? mergeWikidataPlayer(byId.get(player.id)!, player) : player);
  };

  const publicPlayers = await readJsonFile<{ players?: UnknownRecord[] }>('public/data/players.json');
  if (publicPlayers?.players) {
    sources.push('public/data/players.json');
    publicPlayers.players.forEach((record) => addPlayer(playerFromAny(record)));
  }

  const rawPlayers = await readJsonFile<{ players?: UnknownRecord[] }>('data/raw/wikidata-players.json');
  if (rawPlayers?.players) {
    sources.push('data/raw/wikidata-players.json');
    rawPlayers.players.forEach((record) => addPlayer(playerFromAny(record)));
  }

  try {
    const files = await readdir('data/raw/wikidata-clubs');
    for (const filename of files.filter((file) => file.endsWith('.json') && !file.endsWith('.partial.json'))) {
      const filePath = `data/raw/wikidata-clubs/${filename}`;
      const clubFile = await readJsonFile<{ players?: UnknownRecord[] }>(filePath);
      if (clubFile?.players?.length) {
        sources.push(filePath);
        clubFile.players.forEach((record) => addPlayer(playerFromAny(record)));
      }
    }
  } catch {
    // Raw club cache is optional.
  }

  return { players: [...byId.values()], sources };
}

function wikidataNames(player: WikidataPlayer): string[] {
  return unique([
    player.id,
    player.name,
    player.cnName,
    player.displayName,
    simplifyChinese(player.cnName),
    simplifyChinese(player.displayName),
    ...aliasNamesFor([player.name, player.cnName, player.displayName].filter((value): value is string => Boolean(value))),
  ].filter((value): value is string => Boolean(value)));
}

function buildWikidataNameIndex(players: WikidataPlayer[]): Map<string, WikidataPlayer[]> {
  const index = new Map<string, WikidataPlayer[]>();
  players.forEach((player) => {
    wikidataNames(player).forEach((name) => {
      const key = normalizeNameKey(name);
      if (!key) return;
      index.set(key, [...(index.get(key) ?? []), player]);
    });
  });
  return index;
}

function positionGroup(position: NormalizedPosition): string {
  if (position === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(position)) return 'MID';
  return 'ATT';
}

function scoreMatch(local: LocalPlayer, player: WikidataPlayer): CandidateMatch {
  let score = 0;
  const reasons: string[] = [];
  const localEnglishKeys = local.names.filter((name) => !hasChinese(name)).map(normalizeNameKey).filter(Boolean);
  const localChineseKeys = local.names.filter(hasChinese).map(normalizeNameKey).filter(Boolean);
  const wdNames = wikidataNames(player);
  const wdKeys = wdNames.map(normalizeNameKey).filter(Boolean);
  const wdEnglishKeys = wdNames.filter((name) => !hasChinese(name)).map(normalizeNameKey).filter(Boolean);
  const wdChineseKeys = wdNames.filter(hasChinese).map(normalizeNameKey).filter(Boolean);

  if (localEnglishKeys.some((key) => wdEnglishKeys.includes(key))) {
    score += 40;
    reasons.push('englishName exact match');
  } else if (localEnglishKeys.some((key) => wdKeys.includes(key))) {
    score += 35;
    reasons.push('englishName normalized match');
  }

  if (localChineseKeys.some((key) => wdChineseKeys.includes(key))) {
    score += 30;
    reasons.push('Chinese name exact match');
  }

  const aliasKeys = aliasNamesFor(local.names).map(normalizeNameKey).filter(Boolean);
  if (aliasKeys.some((key) => wdKeys.includes(key))) {
    score += 10;
    reasons.push('alias match');
  }

  if (local.birthYear && player.birthYear && local.birthYear === player.birthYear) {
    score += 25;
    reasons.push('birthYear match');
  }

  const localCountry = normalizeCountry(local.nationality);
  const wdCountry = normalizeCountry(player.nationality);
  if (localCountry && wdCountry && localCountry === wdCountry) {
    score += 15;
    reasons.push('nationality match');
  }

  const localGroups = new Set(local.normalizedPositions.map(positionGroup));
  const wdGroups = new Set(player.normalizedPositions.map(positionGroup));
  if ([...localGroups].some((group) => wdGroups.has(group))) {
    score += 10;
    reasons.push('position group overlap');
  }

  const localTeamKeys = local.sourceTeams.map(normalizeNameKey).filter(Boolean);
  const wdClubKeys = player.clubs.flatMap((club) => [club.clubId, club.clubName, club.clubCnName]).map(normalizeNameKey).filter(Boolean);
  if (localTeamKeys.some((key) => wdClubKeys.includes(key))) {
    score += 25;
    reasons.push('club history overlap');
  }

  if (reasons.length >= 2) {
    score += 10;
    reasons.push('multiple evidence bonus');
  }

  return { player, score: Math.min(score, 100), reasons };
}

function levelFor(score: number): MatchLevel {
  if (score >= 85) return 'autoMatch';
  if (score >= 70) return 'probableMatch';
  if (score >= 50) return 'weakMatch';
  return 'noMatch';
}

function findMatch(local: LocalPlayer, nameIndex: Map<string, WikidataPlayer[]>): { link: LinkRecord; official?: CandidateMatch; weak?: CandidateMatch } {
  const candidateMap = new Map<string, WikidataPlayer>();
  local.names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key) return;
    (nameIndex.get(key) ?? []).forEach((player) => candidateMap.set(player.id, player));
  });
  aliasNamesFor(local.names).forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key) return;
    (nameIndex.get(key) ?? []).forEach((player) => candidateMap.set(player.id, player));
  });

  const scored = [...candidateMap.values()]
    .map((player) => scoreMatch(local, player))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || (a.player.name ?? a.player.id).localeCompare(b.player.name ?? b.player.id));

  const best = scored[0];
  const second = scored[1];
  const ambiguous = Boolean(best && second && best.score >= 50 && best.score - second.score < 10);
  const matchLevel = best ? levelFor(best.score) : 'noMatch';
  const official = best && !ambiguous && (matchLevel === 'autoMatch' || matchLevel === 'probableMatch') ? best : undefined;
  const weak = best && matchLevel === 'weakMatch' ? best : undefined;

  return {
    official,
    weak,
    link: {
      lskPlayerId: local.lskPlayerId,
      lskName: local.lskName,
      lskEnglishName: local.lskEnglishName ?? '',
      wikidataQid: official?.player.id ?? '',
      wikidataName: official?.player.name ?? '',
      matchConfidence: best?.score ?? 0,
      matchLevel: ambiguous ? 'noMatch' : matchLevel,
      matchReasons: best?.reasons ?? [],
      ambiguousCandidates: (ambiguous ? scored.slice(0, 5) : scored.slice(1, 4)).map((match) => ({
        wikidataQid: match.player.id,
        wikidataName: match.player.name ?? match.player.displayName,
        matchConfidence: match.score,
        matchReasons: match.reasons,
      })),
    },
  };
}

function eraTagsForCareer(fromYear?: number, toYear?: number): Era[] {
  if (!fromYear) return [];
  const endYear = toYear && toYear >= fromYear ? toYear : fromYear;
  return ERAS.filter((era) => {
    const start = Number(era.slice(0, 4));
    return Math.max(fromYear, start) <= Math.min(endYear, start + 9);
  });
}

function nameEnhancement(player: WikidataPlayer, local?: LocalPlayer) {
  const originalWikidataName = player.name;
  const originalWikidataZh = player.cnName;
  const originalWikidataZhHant = player.cnName && simplifyChinese(player.cnName) !== player.cnName ? player.cnName : undefined;
  const simplifiedWikidataName = simplifyChinese(player.cnName);
  const lskMatchedName = local?.cnName ?? local?.names.find(hasChinese);

  let displayName = lskMatchedName ? simplifyChinese(lskMatchedName) : undefined;
  let nameSource: NameSource = 'lsk-local';
  if (!displayName && simplifiedWikidataName) {
    displayName = simplifiedWikidataName;
    nameSource = originalWikidataZhHant ? 'wikidata-zh-converted' : 'wikidata-zh-hans';
  }
  if (!displayName && player.name) {
    displayName = player.name;
    nameSource = 'wikidata-en';
  }
  if (!displayName) {
    displayName = player.id;
    nameSource = 'qid';
  }

  return {
    originalWikidataName,
    originalWikidataZh,
    originalWikidataZhHant,
    simplifiedWikidataName,
    lskMatchedName: displayName && nameSource === 'lsk-local' ? displayName : undefined,
    displayName,
    nameSource,
  };
}

function buildSearchNames(player: WikidataPlayer, enhancedName: string, local?: LocalPlayer): string[] {
  return unique([
    enhancedName,
    player.id,
    player.name,
    player.cnName,
    player.displayName,
    simplifyChinese(player.cnName),
    ...(local?.names ?? []),
    ...(local?.aliases ?? []),
  ].filter((value): value is string => Boolean(value)));
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const [localResult, wikidataResult] = await Promise.all([loadLocalPlayers(), loadWikidataPlayers()]);
  const localPlayers = localResult.players;
  const wikidataPlayers = wikidataResult.players;
  const wikidataById = new Map(wikidataPlayers.map((player) => [player.id, player]));
  const nameIndex = buildWikidataNameIndex(wikidataPlayers);

  const links: LinkRecord[] = [];
  const officialByQid = new Map<string, { local: LocalPlayer; match: CandidateMatch }>();
  const weakMatches: LinkRecord[] = [];
  const ambiguousMatches: LinkRecord[] = [];
  const noMatches: LinkRecord[] = [];

  localPlayers.forEach((local) => {
    const result = findMatch(local, nameIndex);
    links.push(result.link);
    if (result.official) {
      const existing = officialByQid.get(result.official.player.id);
      if (!existing || existing.match.score < result.official.score) {
        officialByQid.set(result.official.player.id, { local, match: result.official });
      }
    } else if (result.link.ambiguousCandidates.length > 1 && result.link.matchConfidence >= 50) {
      ambiguousMatches.push(result.link);
    } else if (result.weak) {
      weakMatches.push(result.link);
    } else {
      noMatches.push(result.link);
    }
  });

  const officialLinks = links.filter((link) => link.wikidataQid);
  const careerRecords: unknown[] = [];
  const identityRecords: unknown[] = [];
  const aiIndexRecords: unknown[] = [];
  const nameStats = {
    lskNameEnhancedCount: 0,
    wikidataSimplifiedNameCount: 0,
    traditionalConvertedCount: 0,
    englishFallbackCount: 0,
    qidFallbackCount: 0,
  };
  const traditionalSamples: unknown[] = [];
  const englishFallbackPlayers: unknown[] = [];
  let positionEnhancedCount = 0;
  let careerEnhancedCount = 0;
  let chineseNameEnhancedCount = 0;

  wikidataPlayers.forEach((player) => {
    const official = officialByQid.get(player.id);
    const local = official?.local;
    const name = nameEnhancement(player, local);
    if (name.nameSource === 'lsk-local') nameStats.lskNameEnhancedCount += 1;
    if (name.nameSource.startsWith('wikidata-zh')) nameStats.wikidataSimplifiedNameCount += 1;
    if (name.originalWikidataZhHant) {
      nameStats.traditionalConvertedCount += 1;
      if (traditionalSamples.length < 30) {
        traditionalSamples.push({ original: name.originalWikidataZhHant, simplified: name.simplifiedWikidataName, qid: player.id });
      }
    }
    if (name.nameSource === 'wikidata-en') {
      nameStats.englishFallbackCount += 1;
      if (englishFallbackPlayers.length < 30) {
        englishFallbackPlayers.push({ wikidataQid: player.id, name: player.name, displayName: name.displayName });
      }
    }
    if (name.nameSource === 'qid') nameStats.qidFallbackCount += 1;

    const mergedPositions = unique([...(player.normalizedPositions ?? []), ...(local?.normalizedPositions ?? [])]);
    const sourcePositions = unique([...(player.positions ?? []), ...(local?.sourcePositions ?? [])]);
    if (local && local.normalizedPositions.some((position) => !player.normalizedPositions.includes(position))) {
      positionEnhancedCount += 1;
    }
    if (local && name.displayName && hasChinese(name.displayName)) chineseNameEnhancedCount += 1;

    const careers = player.clubs
      .filter((club) => club.fromYear || club.toYear)
      .map((club) => ({
        clubKey: club.clubId,
        clubName: club.clubCnName ?? club.clubName,
        startYear: club.fromYear ?? 0,
        endYear: club.toYear ?? club.fromYear ?? 0,
        eraTags: eraTagsForCareer(club.fromYear, club.toYear),
        source: 'wikidata',
        confidence: club.fromYear ? 'high' : 'medium',
      }));
    if (local && careers.length > 0) careerEnhancedCount += 1;

    const careerClubKeys = unique(careers.map((career) => career.clubKey));
    const careerEraTags = unique(careers.flatMap((career) => career.eraTags));
    const availableClubEraKeys = unique(careers.flatMap((career) => career.eraTags.map((era) => `${career.clubKey}__${era}`)));
    const availablePositionPoolKeys = unique(
      careers.flatMap((career) => career.eraTags.flatMap((era) => mergedPositions.map((position) => `${career.clubKey}__${era}__${position}`))),
    );
    const matchConfidence = official?.match.score ?? 0;
    const lskPlayerId = local?.lskPlayerId ?? '';
    const sourceQuality = careers.length > 0 && mergedPositions.length > 0 ? (matchConfidence >= 70 ? 'high' : 'medium') : 'low';

    careerRecords.push({
      lskPlayerId,
      wikidataQid: player.id,
      displayName: name.displayName,
      careers,
    });

    identityRecords.push({
      lskPlayerId,
      wikidataQid: player.id,
      displayName: name.displayName,
      cnName: hasChinese(name.displayName) ? name.displayName : undefined,
      englishName: player.name ?? '',
      birthYear: player.birthYear ?? 0,
      nationality: player.nationality ?? '',
      positions: sourcePositions,
      normalizedPositions: mergedPositions,
      sourcePositions,
      careerClubKeys,
      careerEraTags,
      sourcePriority: {
        name: name.nameSource === 'lsk-local' ? 'lsk-local' : 'wikidata',
        positions: local ? 'merged' : 'wikidata',
        career: 'wikidata',
        birthYear: 'wikidata',
      },
      originalWikidataName: name.originalWikidataName,
      originalWikidataZh: name.originalWikidataZh,
      originalWikidataZhHant: name.originalWikidataZhHant,
      simplifiedWikidataName: name.simplifiedWikidataName,
      lskMatchedName: name.lskMatchedName,
      nameSource: name.nameSource,
      matchConfidence,
    });

    aiIndexRecords.push({
      lskPlayerId,
      wikidataQid: player.id,
      displayName: name.displayName,
      searchNames: buildSearchNames(player, name.displayName, local),
      englishName: player.name ?? '',
      cnName: hasChinese(name.displayName) ? name.displayName : undefined,
      birthYear: player.birthYear ?? 0,
      nationality: player.nationality ?? '',
      positions: sourcePositions,
      normalizedPositions: mergedPositions,
      careerSpells: careers.map((career) => ({
        clubKey: career.clubKey,
        clubName: career.clubName,
        startYear: career.startYear,
        endYear: career.endYear,
        eraTags: career.eraTags,
      })),
      availableClubEraKeys,
      availablePositionPoolKeys,
      sourceQuality,
      matchConfidence,
      originalWikidataName: name.originalWikidataName,
      originalWikidataZh: name.originalWikidataZh,
      originalWikidataZhHant: name.originalWikidataZhHant,
      simplifiedWikidataName: name.simplifiedWikidataName,
      lskMatchedName: name.lskMatchedName,
      nameSource: name.nameSource,
    });
  });

  const report = {
    generatedAt: new Date().toISOString(),
    inputSources: {
      lskLocal: localResult.sources,
      wikidata: wikidataResult.sources,
    },
    totalLskPlayers: localPlayers.length,
    totalWikidataPlayers: wikidataPlayers.length,
    autoMatchCount: links.filter((link) => link.wikidataQid && link.matchLevel === 'autoMatch').length,
    probableMatchCount: links.filter((link) => link.wikidataQid && link.matchLevel === 'probableMatch').length,
    weakMatchCount: weakMatches.length,
    noMatchCount: noMatches.length,
    ambiguousMatchCount: ambiguousMatches.length,
    careerEnhancedCount,
    positionEnhancedCount,
    chineseNameEnhancedCount,
    traditionalConvertedCount: nameStats.traditionalConvertedCount,
    playersWithCareerSpells: wikidataPlayers.filter((player) => player.clubs.length > 0).length,
    playersWithMultiPosition: identityRecords.filter((record) => isRecord(record) && Array.isArray(record.normalizedPositions) && record.normalizedPositions.length > 1).length,
    lskNameEnhancedCount: nameStats.lskNameEnhancedCount,
    wikidataSimplifiedNameCount: nameStats.wikidataSimplifiedNameCount,
    englishFallbackCount: nameStats.englishFallbackCount,
    qidFallbackCount: nameStats.qidFallbackCount,
    topUnmatchedLskPlayers: noMatches.slice(0, 50),
    topAmbiguousMatches: ambiguousMatches.slice(0, 50),
    sampleAutoMatches: links.filter((link) => link.wikidataQid && link.matchLevel === 'autoMatch').slice(0, 30),
    sampleProbableMatches: links.filter((link) => link.wikidataQid && link.matchLevel === 'probableMatch').slice(0, 30),
    topEnglishFallbackPlayers: englishFallbackPlayers,
    topTraditionalConvertedSamples: traditionalSamples,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeJson(`${OUTPUT_DIR}/lsk_player_wikidata_links.json`, links);
  await writeJson(`${OUTPUT_DIR}/lsk_player_careers.json`, careerRecords);
  await writeJson(`${OUTPUT_DIR}/lsk_player_identity_enriched.json`, identityRecords);
  await writeJson(`${OUTPUT_DIR}/lsk_ai_player_index.json`, aiIndexRecords);
  await writeJson(`${OUTPUT_DIR}/enrichment_report.json`, report);

  console.log('LSK Wikidata enrichment complete.');
  console.log(JSON.stringify({
    totalLskPlayers: report.totalLskPlayers,
    totalWikidataPlayers: report.totalWikidataPlayers,
    autoMatchCount: report.autoMatchCount,
    probableMatchCount: report.probableMatchCount,
    weakMatchCount: report.weakMatchCount,
    ambiguousMatchCount: report.ambiguousMatchCount,
    noMatchCount: report.noMatchCount,
    careerEnhancedCount: report.careerEnhancedCount,
    positionEnhancedCount: report.positionEnhancedCount,
    chineseNameEnhancedCount: report.chineseNameEnhancedCount,
    lskNameEnhancedCount: report.lskNameEnhancedCount,
    traditionalConvertedCount: report.traditionalConvertedCount,
    englishFallbackCount: report.englishFallbackCount,
    qidFallbackCount: report.qidFallbackCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
