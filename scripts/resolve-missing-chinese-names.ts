import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

type UnknownRecord = Record<string, unknown>;
type NameSource = 'lsk-local' | 'wikidata-zh' | 'zhwiki-title' | 'zhwiki-search' | 'auto-transliteration' | 'unresolved';
type Confidence = 'high' | 'medium' | 'low';

interface MissingNameRecord {
  wikidataQid: string;
  playerId: string;
  currentDisplayName: string;
  englishName: string;
  nationality: string;
  birthYear: number;
  positions: string[];
  clubEraExamples: string[];
  candidateAppearCount: number;
  sourcePools: string[];
}

interface ResolvedNameRecord {
  wikidataQid: string;
  playerId: string;
  englishName: string;
  currentDisplayName: string;
  resolvedDisplayName: string;
  source: NameSource;
  confidence: Confidence;
  nationality: string;
  inferredLanguage: string;
  reason: string;
  clubEraExamples: string[];
  candidateAppearCount: number;
  canApplyByDefault: boolean;
  suspiciousName: boolean;
  suspiciousReason?: string;
}

const execFileAsync = promisify(execFile);
const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT_MISSING = 'data/enriched/missing_chinese_names_report.json';
const OUTPUT_RESOLVED = 'data/enriched/auto_resolved_chinese_names.json';
const RESOLVE_NAME_LIMIT = parseResolveNameLimit(process.env.RESOLVE_NAME_LIMIT);
const WIKIDATA_ENTITY_BATCH_SIZE = Number(process.env.RESOLVE_WIKIDATA_ENTITY_BATCH_SIZE ?? 50);
const WIKIDATA_REQUEST_DELAY_MS = Number(process.env.RESOLVE_WIKIDATA_REQUEST_DELAY_MS ?? 3000);
const ZHWIKI_SEARCH_LIMIT = Number(process.env.RESOLVE_NAMES_ZHWIKI_SEARCH_LIMIT ?? Math.min(RESOLVE_NAME_LIMIT, 20));

function parseResolveNameLimit(value: string | undefined): number {
  if (!value) return 500;
  if (value.toLowerCase() === 'all') return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SPANISH_COUNTRIES = new Set(['spain', 'argentina', 'uruguay', 'colombia', 'chile', 'mexico', 'paraguay', 'peru', 'venezuela', 'ecuador']);
const PORTUGUESE_COUNTRIES = new Set(['brazil', 'portugal']);
const FRENCH_COUNTRIES = new Set(['france', 'belgium', 'senegal', 'ivory coast', 'cameroon', 'morocco', 'algeria']);
const GERMAN_COUNTRIES = new Set(['germany', 'austria', 'switzerland']);
const ITALIAN_COUNTRIES = new Set(['italy']);
const DUTCH_COUNTRIES = new Set(['netherlands']);
const ENGLISH_COUNTRIES = new Set(['england', 'scotland', 'wales', 'ireland', 'united states']);
const SOUTH_SLAVIC_COUNTRIES = new Set(['croatia', 'serbia', 'bosnia and herzegovina']);

const COUNTRY_ALIASES: Record<string, string> = {
  西班牙: 'spain',
  阿根廷: 'argentina',
  乌拉圭: 'uruguay',
  烏拉圭: 'uruguay',
  哥伦比亚: 'colombia',
  哥倫比亞: 'colombia',
  智利: 'chile',
  墨西哥: 'mexico',
  巴拉圭: 'paraguay',
  秘鲁: 'peru',
  秘魯: 'peru',
  委内瑞拉: 'venezuela',
  委內瑞拉: 'venezuela',
  厄瓜多尔: 'ecuador',
  厄瓜多爾: 'ecuador',
  巴西: 'brazil',
  葡萄牙: 'portugal',
  法国: 'france',
  法國: 'france',
  比利时: 'belgium',
  比利時: 'belgium',
  塞内加尔: 'senegal',
  塞內加爾: 'senegal',
  科特迪瓦: 'ivory coast',
  喀麦隆: 'cameroon',
  喀麥隆: 'cameroon',
  摩洛哥: 'morocco',
  阿尔及利亚: 'algeria',
  阿爾及利亞: 'algeria',
  德国: 'germany',
  德國: 'germany',
  奥地利: 'austria',
  奧地利: 'austria',
  瑞士: 'switzerland',
  意大利: 'italy',
  荷兰: 'netherlands',
  荷蘭: 'netherlands',
  英格兰: 'england',
  英格蘭: 'england',
  苏格兰: 'scotland',
  蘇格蘭: 'scotland',
  威尔士: 'wales',
  威爾士: 'wales',
  爱尔兰: 'ireland',
  愛爾蘭: 'ireland',
  美国: 'united states',
  美國: 'united states',
  克罗地亚: 'croatia',
  克羅地亞: 'croatia',
  塞尔维亚: 'serbia',
  塞爾維亞: 'serbia',
  波黑: 'bosnia and herzegovina',
};

const TRADITIONAL_CHARS: Record<string, string> = {
  亞: '亚',
  貝: '贝',
  漢: '汉',
  羅: '罗',
  納: '纳',
  爾: '尔',
  馬: '马',
  齊: '齐',
  達: '达',
  內: '内',
  謝: '谢',
  勞: '劳',
  約: '约',
  維: '维',
  盧: '卢',
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
  歐: '欧',
  陽: '阳',
  義: '义',
  龍: '龙',
  歷: '历',
};

const TOKEN_MAP: Record<string, Record<string, string>> = {
  spanish: {
    jesus: '赫苏斯',
    jose: '何塞',
    julio: '胡利奥',
    enrique: '恩里克',
    roberto: '罗伯托',
    miguel: '米格尔',
    carlos: '卡洛斯',
    fernando: '费尔南多',
    javier: '哈维尔',
    gonzalez: '冈萨雷斯',
    martin: '马丁',
    prieto: '普列托',
    ramos: '拉莫斯',
    alejandro: '亚历杭德罗',
    antonio: '安东尼奥',
    luis: '路易斯',
    alberto: '阿尔贝托',
    garcia: '加西亚',
    sanchez: '桑切斯',
    perez: '佩雷斯',
    lopez: '洛佩斯',
    rodriguez: '罗德里格斯',
    martinez: '马丁内斯',
    gutierrez: '古铁雷斯',
    fernandez: '费尔南德斯',
    landaburu: '兰达布鲁',
    marina: '马里纳',
  },
  portuguese: {
    joao: '若昂',
    jose: '若泽',
    luis: '路易斯',
    luiz: '路易斯',
    paulo: '保罗',
    roberto: '罗伯托',
    carlos: '卡洛斯',
    silva: '席尔瓦',
    santos: '桑托斯',
    pereira: '佩雷拉',
    antonio: '安东尼奥',
    fernando: '费尔南多',
    ronaldo: '罗纳尔多',
    ricardo: '里卡多',
    eduardo: '爱德华多',
  },
  english: {
    david: '大卫',
    michael: '迈克尔',
    steven: '史蒂文',
    john: '约翰',
    paul: '保罗',
    frank: '弗兰克',
    gary: '加里',
    kevin: '凯文',
    mark: '马克',
    alan: '阿兰',
    peter: '彼得',
    james: '詹姆斯',
    george: '乔治',
    robert: '罗伯特',
    robbie: '罗比',
    wayne: '韦恩',
    andy: '安迪',
  },
  italian: {
    paolo: '保罗',
    roberto: '罗伯托',
    alessandro: '亚历山德罗',
    franco: '弗兰科',
    giuseppe: '朱塞佩',
    andrea: '安德烈亚',
    antonio: '安东尼奥',
    marco: '马尔科',
    carlo: '卡洛',
    daniele: '达尼埃莱',
    filippo: '菲利波',
    giovanni: '乔瓦尼',
  },
  french: {
    michel: '米歇尔',
    jean: '让',
    thierry: '蒂埃里',
    laurent: '洛朗',
    patrick: '帕特里克',
    frederic: '弗雷德里克',
    sylvain: '西尔万',
    kevin: '凯文',
    sammy: '萨米',
    armand: '阿尔芒',
    traore: '特拉奥雷',
    rimane: '里马内',
  },
  german: {
    franz: '弗朗茨',
    karl: '卡尔',
    thomas: '托马斯',
    jurgen: '于尔根',
    gerd: '盖德',
    hans: '汉斯',
    klaus: '克劳斯',
    andreas: '安德烈亚斯',
    oliver: '奥利弗',
    stefan: '斯特凡',
  },
  dutch: {
    johan: '约翰',
    john: '约翰',
    frank: '弗兰克',
    marco: '马尔科',
    dennis: '丹尼斯',
    patrick: '帕特里克',
    ruud: '路德',
    rob: '罗布',
    arjen: '阿尔扬',
  },
  southSlavic: {
    ivan: '伊万',
    luka: '卢卡',
    dejan: '德扬',
    nikola: '尼古拉',
    marko: '马尔科',
    mario: '马里奥',
    milan: '米兰',
    mirko: '米尔科',
    jovic: '约维奇',
    petrovic: '彼得罗维奇',
  },
};

const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'del', 'della', 'di', 'van', 'von', 'e']);

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

function simplifyChinese(value?: string): string | undefined {
  if (!value) return undefined;
  return [...value].map((char) => TRADITIONAL_CHARS[char] ?? char).join('').trim() || undefined;
}

function hasChinese(value?: string): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

const SHORT_NAME_WHITELIST = new Set(['C罗', '梅西', '卡卡', '小罗', '大罗', '贝利', '卡福', '莱奥', '内马尔', '罗马里奥']);
const COMMON_NICKNAME_LIKE_NAMES = new Set([
  '莱奥',
  '路易',
  '路易斯',
  '保罗',
  '胡安',
  '若昂',
  '卢卡',
  '大卫',
  '米歇尔',
  '马克',
  '托尼',
  '阿兰',
  '卡洛',
  '卡洛斯',
]);

function compactChineseName(value: string): string {
  return value.replace(/[·.\s\-()（）]/g, '');
}

function detectSuspiciousResolvedName(englishName: string, resolvedDisplayName: string, source: NameSource): { suspiciousName: boolean; reason?: string } {
  if (source === 'lsk-local' || source === 'auto-transliteration') return { suspiciousName: false };
  if (SHORT_NAME_WHITELIST.has(resolvedDisplayName)) return { suspiciousName: false };

  const compactName = compactChineseName(resolvedDisplayName);
  const englishTokenCount = englishName.split(/[\s.'’,-]+/).filter(Boolean).length;
  const chinesePartCount = resolvedDisplayName.split(/[·\s]+/).filter(Boolean).length;

  if (/消歧义|消歧義|列表|页面|頁面|昵称|暱稱/.test(resolvedDisplayName)) {
    return { suspiciousName: true, reason: 'resolved name looks like a disambiguation, nickname, or incomplete page title' };
  }

  if (compactName === '莱奥' && /\b(leão|leao|leo|léo)\b|rafael le[aã]o|leonardo lourenço bastos/i.test(englishName)) {
    return { suspiciousName: false };
  }

  if (compactName.length <= 2) {
    return { suspiciousName: true, reason: 'resolved name may be too short or nickname-like' };
  }

  if (COMMON_NICKNAME_LIKE_NAMES.has(compactName) && chinesePartCount <= 1) {
    return { suspiciousName: true, reason: 'resolved name may be a common given name without surname' };
  }

  if (englishTokenCount >= 2 && chinesePartCount <= 1 && compactName.length <= 3) {
    return { suspiciousName: true, reason: 'resolved name loses too much information compared with the English name' };
  }

  return { suspiciousName: false };
}

function hasLatin(value?: string): boolean {
  return Boolean(value && /[A-Za-zÀ-ž]/.test(value));
}

function isMostlyLatinName(displayName?: string, cnName?: string): boolean {
  const value = displayName || cnName || '';
  if (!value) return false;
  const letters = [...value].filter((char) => /[A-Za-zÀ-ž\u3400-\u9fff]/.test(char));
  if (letters.length === 0) return false;
  const latinCount = letters.filter((char) => /[A-Za-zÀ-ž]/.test(char)).length;
  const chineseCount = letters.filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  return latinCount > 0 && latinCount > chineseCount;
}

function normalizeNameKey(value?: string): string | undefined {
  const text = simplifyChinese(value);
  if (!text) return undefined;
  const key = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return key || undefined;
}

function parseYear(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric && numeric >= 1870 && numeric <= 2035) return Math.trunc(numeric);
  const text = stringValue(value);
  if (!text) return undefined;
  const match = text.match(/\b(19\d{2}|20\d{2})\b/) ?? text.match(/^(-?\d{4})-/);
  const year = Number(match?.[1]);
  return year >= 1870 && year <= 2035 ? year : undefined;
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const result = await stat(filePath);
    return result.isFile();
  } catch {
    return false;
  }
}

async function readJsonRecords(paths: string[], sourceName: string): Promise<UnknownRecord[]> {
  for (const filePath of paths) {
    if (!(await exists(filePath))) continue;
    const json = await readJson<unknown>(filePath);
    const rows = Array.isArray(json)
      ? json
      : isRecord(json) && Array.isArray(json.players)
        ? json.players
        : isRecord(json) && Array.isArray(json.data)
          ? json.data
          : [];
    console.log(`Loaded ${rows.length} optional ${sourceName} records from ${filePath}`);
    return rows.filter(isRecord);
  }
  return [];
}

async function readSqliteRows(): Promise<UnknownRecord[]> {
  const sqlitePath = '/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/players.sqlite';
  if (!(await exists(sqlitePath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-json',
      sqlitePath,
      "SELECT player_id, fo4pid, uid, name, position, team, country, nationality, birth_date FROM players;",
    ], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout || '[]') as unknown;
    console.log(`Loaded ${Array.isArray(rows) ? rows.length : 0} optional LSK sqlite player rows.`);
    return Array.isArray(rows) ? rows.filter(isRecord) : [];
  } catch (error) {
    console.warn(`Skipped optional LSK sqlite rows: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function namesFromLocalRecord(record: UnknownRecord): string[] {
  return unique([
    stringValue(record.displayName),
    stringValue(record.display_name),
    stringValue(record.name),
    stringValue(record.playerName),
    stringValue(record.fullName),
    stringValue(record.cnName),
    stringValue(record.nameCn),
    stringValue(record.zhName),
  ].filter((value): value is string => Boolean(value)));
}

async function buildLocalChineseNameIndex() {
  const rows = [
    ...(await readJsonRecords([
      process.env.LSK_LOCAL_PLAYERS_JSON ?? '',
      'data/local/players_all.json',
      'data/raw/players_all.json',
      '/Users/ziyijoeychen/Desktop/FCOnline_Player_DB/data/players_all.json',
    ].filter(Boolean), 'LSK players JSON')),
    ...(await readSqliteRows()),
  ];

  const byName = new Map<string, string>();
  rows.forEach((record) => {
    const names = namesFromLocalRecord(record);
    const chineseName = names.map(simplifyChinese).find((name) => hasChinese(name) && !hasLatin(name));
    if (!chineseName) return;
    names.forEach((name) => {
      const key = normalizeNameKey(name);
      if (key) byName.set(key, chineseName);
    });
  });
  return byName;
}

async function loadRawWikidataById() {
  const byId = new Map<string, UnknownRecord>();
  const rawPlayers = await readJson<{ players?: UnknownRecord[] }>('data/raw/wikidata-players.json');
  rawPlayers?.players?.filter(isRecord).forEach((player) => {
    const id = stringValue(player.id);
    if (id) byId.set(id, { ...(byId.get(id) ?? {}), ...player });
  });
  try {
    const files = await readdir('data/raw/wikidata-clubs');
    for (const filename of files.filter((file) => file.endsWith('.json') && !file.endsWith('.partial.json'))) {
      const clubFile = await readJson<{ players?: UnknownRecord[] }>(`data/raw/wikidata-clubs/${filename}`);
      clubFile?.players?.filter(isRecord).forEach((player) => {
        const id = stringValue(player.id);
        if (id) byId.set(id, { ...(byId.get(id) ?? {}), ...player });
      });
    }
  } catch {
    // Optional raw club cache.
  }
  return byId;
}

function sourcePoolInfo(squadPools: UnknownRecord) {
  const byPlayer = new Map<string, { sourcePools: Set<string>; clubEraExamples: Set<string>; count: number }>();
  const visit = (source: unknown) => {
    if (!isRecord(source)) return;
    Object.entries(source).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      value.filter(isRecord).forEach((candidate) => {
        const playerId = stringValue(candidate.playerId);
        if (!playerId) return;
        const bucket = byPlayer.get(playerId) ?? { sourcePools: new Set<string>(), clubEraExamples: new Set<string>(), count: 0 };
        if (!bucket.sourcePools.has(key)) bucket.count += 1;
        bucket.sourcePools.add(key);
        const clubId = stringValue(candidate.clubId);
        const era = stringValue(candidate.era);
        if (clubId && era) bucket.clubEraExamples.add(`${clubId}__${era}`);
        byPlayer.set(playerId, bucket);
      });
    });
  };
  visit(squadPools.pools);
  visit(squadPools.relaxedPools);
  return byPlayer;
}

function countryKey(nationality?: string): string {
  const normalized = normalizeNameKey(nationality) ?? '';
  return COUNTRY_ALIASES[nationality ?? ''] ?? COUNTRY_ALIASES[normalized] ?? normalized;
}

function inferLanguage(nationality?: string): string {
  const key = countryKey(nationality);
  if (SPANISH_COUNTRIES.has(key)) return 'spanish';
  if (PORTUGUESE_COUNTRIES.has(key)) return 'portuguese';
  if (FRENCH_COUNTRIES.has(key)) return 'french';
  if (GERMAN_COUNTRIES.has(key)) return 'german';
  if (ITALIAN_COUNTRIES.has(key)) return 'italian';
  if (DUTCH_COUNTRIES.has(key)) return 'dutch';
  if (ENGLISH_COUNTRIES.has(key)) return 'english';
  if (SOUTH_SLAVIC_COUNTRIES.has(key)) return 'southSlavic';
  return 'english';
}

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function roughTransliterateToken(token: string, language: string): string {
  const lower = stripDiacritics(token).toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return '';
  const languageMap = TOKEN_MAP[language] ?? TOKEN_MAP.english;
  const common = { ...TOKEN_MAP.english, ...TOKEN_MAP.spanish, ...TOKEN_MAP.portuguese, ...TOKEN_MAP.italian, ...TOKEN_MAP.french, ...TOKEN_MAP.german, ...TOKEN_MAP.dutch, ...TOKEN_MAP.southSlavic, ...languageMap };
  if (common[lower]) return common[lower];

  const chunkMap: Array<[RegExp, string]> = [
    [/sch/g, '施'],
    [/ch/g, '奇'],
    [/sh/g, '什'],
    [/th/g, '特'],
    [/ph/g, '夫'],
    [/qu/g, '奎'],
    [/ck/g, '克'],
    [/ll/g, language === 'spanish' ? '利' : '尔'],
    [/rr/g, '尔'],
  ];
  let work = lower;
  const parts: string[] = [];
  while (work.length > 0) {
    const applied = chunkMap.find(([regex]) => regex.test(work.slice(0, 3)));
    if (applied && work.match(applied[0])?.index === 0) {
      parts.push(applied[1]);
      work = work.replace(applied[0], '');
      continue;
    }
    const two = work.slice(0, 2);
    const twoMap: Record<string, string> = {
      ai: '艾',
      al: '阿尔',
      an: '安',
      ar: '阿尔',
      au: '奥',
      ba: '巴',
      be: '贝',
      bi: '比',
      bo: '博',
      ca: '卡',
      ce: '塞',
      ci: '西',
      co: '科',
      cu: '库',
      da: '达',
      de: '德',
      di: '迪',
      do: '多',
      du: '杜',
      el: '埃尔',
      en: '恩',
      er: '尔',
      fa: '法',
      fe: '费',
      fi: '菲',
      fo: '福',
      ga: '加',
      ge: '热',
      gi: '吉',
      go: '戈',
      gu: '古',
      ha: '哈',
      he: '赫',
      hi: '希',
      ho: '霍',
      ja: '哈',
      je: '热',
      jo: language === 'portuguese' ? '若' : '霍',
      ju: '胡',
      ka: '卡',
      ke: '凯',
      ki: '基',
      ko: '科',
      la: '拉',
      le: '莱',
      li: '利',
      lo: '洛',
      lu: '卢',
      ma: '马',
      me: '梅',
      mi: '米',
      mo: '莫',
      na: '纳',
      ne: '内',
      ni: '尼',
      no: '诺',
      pa: '帕',
      pe: '佩',
      pi: '皮',
      po: '波',
      ra: '拉',
      re: '雷',
      ri: '里',
      ro: '罗',
      ru: '鲁',
      sa: '萨',
      se: '塞',
      si: '西',
      so: '索',
      ta: '塔',
      te: '特',
      ti: '蒂',
      to: '托',
      va: '瓦',
      ve: '韦',
      vi: '维',
      vo: '沃',
      za: '扎',
      ze: '泽',
      zi: '齐',
      zo: '佐',
    };
    if (twoMap[two]) {
      parts.push(twoMap[two]);
      work = work.slice(2);
      continue;
    }
    const oneMap: Record<string, string> = {
      a: '阿',
      b: '布',
      c: '克',
      d: '德',
      e: '埃',
      f: '夫',
      g: '格',
      h: '赫',
      i: '伊',
      j: '杰',
      k: '克',
      l: '尔',
      m: '姆',
      n: '恩',
      o: '奥',
      p: '普',
      q: '克',
      r: '尔',
      s: '斯',
      t: '特',
      u: '乌',
      v: '夫',
      w: '沃',
      x: '克斯',
      y: '伊',
      z: '兹',
    };
    parts.push(oneMap[work[0]] ?? '');
    work = work.slice(1);
  }
  return parts.join('').replace(/(.)\1{2,}/g, '$1$1');
}

function autoTransliterate(name: string, nationality?: string) {
  const language = inferLanguage(nationality);
  const tokens = stripDiacritics(name)
    .split(/[\s.'’`-]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !PARTICLES.has(token.toLowerCase()));
  const translated = tokens.map((token) => roughTransliterateToken(token, language)).filter(Boolean);
  return {
    displayName: translated.join('·'),
    language,
  };
}

function zhwikiTitleFrom(record?: UnknownRecord): string | undefined {
  const sitelinks = isRecord(record?.sitelinks) ? record?.sitelinks : undefined;
  const zhwiki = isRecord(sitelinks?.zhwiki) ? sitelinks?.zhwiki : undefined;
  return simplifyChinese(stringValue(zhwiki?.title));
}

function wikidataLabelFromEntity(entity?: UnknownRecord): string | undefined {
  const labels = isRecord(entity?.labels) ? entity?.labels : undefined;
  const labelKeys = ['zh-hans', 'zh-cn', 'zh', 'zh-hant'];
  for (const key of labelKeys) {
    const label = isRecord(labels?.[key]) ? labels?.[key] : undefined;
    const value = simplifyChinese(stringValue(label?.value));
    if (value && hasChinese(value) && !isMostlyLatinName(value)) return value;
  }
  return undefined;
}

function zhwikiTitleFromEntity(entity?: UnknownRecord): string | undefined {
  const sitelinks = isRecord(entity?.sitelinks) ? entity?.sitelinks : undefined;
  const zhwiki = isRecord(sitelinks?.zhwiki) ? sitelinks?.zhwiki : undefined;
  const title = simplifyChinese(stringValue(zhwiki?.title));
  return title && hasChinese(title) && !isMostlyLatinName(title) ? title : undefined;
}

async function fetchWikidataNameEntities(ids: string[]): Promise<Map<string, UnknownRecord>> {
  const output = new Map<string, UnknownRecord>();
  if (ids.length === 0 || typeof fetch !== 'function') return output;
  for (let index = 0; index < ids.length; index += WIKIDATA_ENTITY_BATCH_SIZE) {
    const batch = ids.slice(index, index + WIKIDATA_ENTITY_BATCH_SIZE);
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: batch.join('|'),
      props: 'labels|sitelinks',
      languages: 'zh-hans|zh-cn|zh|zh-hant|en',
      sitefilter: 'zhwiki',
      origin: '*',
    });
    const url = `https://www.wikidata.org/w/api.php?${params.toString()}`;
    const batchNumber = Math.floor(index / WIKIDATA_ENTITY_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(ids.length / WIKIDATA_ENTITY_BATCH_SIZE);
    let success = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'LSKFootballDreamXI/1.0 name-resolution',
          },
        });
        clearTimeout(timeout);
        if (!response.ok) {
          if (response.status === 429 && attempt < 3) {
            const waitMs = [30000, 90000, 180000][attempt];
            console.warn(`Wikidata names batch ${batchNumber}/${batchCount} hit 429; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 2}/4.`);
            await sleep(waitMs);
            continue;
          }
          if ((response.status === 502 || response.status === 504) && attempt < 3) {
            const waitMs = [15000, 45000, 90000][attempt];
            console.warn(`Wikidata names batch ${batchNumber}/${batchCount} hit HTTP ${response.status}; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 2}/4.`);
            await sleep(waitMs);
            continue;
          }
          console.warn(`Skipped Wikidata names batch ${batchNumber}/${batchCount}: HTTP ${response.status}`);
          break;
        }
        const json = await response.json() as unknown;
        const entities = isRecord(json) && isRecord(json.entities) ? json.entities : {};
        Object.entries(entities).forEach(([id, entity]) => {
          if (isRecord(entity)) output.set(id, entity);
        });
        success = true;
        break;
      } catch (error) {
        if (attempt < 3) {
          const waitMs = [15000, 45000, 90000][attempt];
          console.warn(`Wikidata names batch ${batchNumber}/${batchCount} failed; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 2}/4.`);
          await sleep(waitMs);
          continue;
        }
        console.warn(`Skipped Wikidata names batch ${batchNumber}/${batchCount}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (success) console.log(`Wikidata names batch ${batchNumber}/${batchCount} success: ${batch.length} ids`);
    if (index + WIKIDATA_ENTITY_BATCH_SIZE < ids.length) await sleep(WIKIDATA_REQUEST_DELAY_MS);
  }
  return output;
}

async function zhwikiSearchTitle(name: string, nationality: string, index: number): Promise<string | undefined> {
  if (index >= ZHWIKI_SEARCH_LIMIT || typeof fetch !== 'function') return undefined;
  const queries = [
    `${name} 足球`,
    `${name} footballer ${nationality}`.trim(),
    `${name} association football player`,
  ];

  for (const query of queries) {
    const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(query)}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const json = await response.json() as unknown;
      const results = isRecord(json) && isRecord(json.query) && Array.isArray(json.query.search) ? json.query.search : [];
      for (const item of results) {
        if (!isRecord(item)) continue;
        const title = simplifyChinese(stringValue(item.title));
        const snippet = simplifyChinese(stringValue(item.snippet)) ?? '';
        const evidence = `${title ?? ''} ${snippet}`;
        const looksLikeFootballer = /足球|足球员|足球員|足球运动员|足球運動員|足球選手|俱乐部|俱樂部|footballer|football player/i.test(evidence);
        if (title && hasChinese(title) && looksLikeFootballer) return title;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function resolveFromLocal(localNameIndex: Map<string, string>, englishName: string): string | undefined {
  return localNameIndex.get(normalizeNameKey(englishName) ?? '');
}

function wikidataZhFrom(record?: UnknownRecord, indexRecord?: UnknownRecord): string | undefined {
  const candidates = [
    stringValue(indexRecord?.displayName),
    stringValue(indexRecord?.cnName),
    stringValue(indexRecord?.simplifiedWikidataName),
    stringValue(indexRecord?.originalWikidataZh),
    stringValue(record?.cnName),
    stringValue(record?.displayName),
    wikidataLabelFromEntity(record),
  ].map(simplifyChinese);
  return candidates.find((name) => hasChinese(name) && !isMostlyLatinName(name));
}

async function main() {
  const playersFile = await readJson<{ players?: UnknownRecord[] }>('public/data/players.json');
  const squadPools = await readJson<UnknownRecord>('public/data/squadPools.json');
  const aiIndexFile = await readJson<unknown>('data/enriched/lsk_ai_player_index.json');
  await readJson<unknown>('data/enriched/enrichment_report.json');
  const indexRows = Array.isArray(aiIndexFile)
    ? aiIndexFile.filter(isRecord)
    : isRecord(aiIndexFile) && Array.isArray(aiIndexFile.results)
      ? aiIndexFile.results.filter(isRecord)
      : [];
  const indexByQid = new Map(indexRows.map((row) => [stringValue(row.wikidataQid), row]).filter((entry): entry is [string, UnknownRecord] => Boolean(entry[0])));
  const rawByQid = await loadRawWikidataById();
  const localChineseNames = await buildLocalChineseNameIndex();
  const poolInfo = sourcePoolInfo(squadPools ?? {});

  const players = (playersFile?.players ?? []).filter(isRecord);
  const missing = players
    .filter((player) => isMostlyLatinName(stringValue(player.displayName), stringValue(player.cnName)))
    .map((player): MissingNameRecord => {
      const playerId = stringValue(player.id) ?? stringValue(player.playerId) ?? '';
      const info = poolInfo.get(playerId);
      return {
        wikidataQid: playerId,
        playerId,
        currentDisplayName: stringValue(player.displayName) ?? '',
        englishName: stringValue(player.name) ?? stringValue(player.displayName) ?? '',
        nationality: stringValue(player.nationality) ?? '',
        birthYear: parseYear(player.birthYear) ?? 0,
        positions: Array.isArray(player.normalizedPositions) ? player.normalizedPositions.map(String) : [],
        clubEraExamples: [...(info?.clubEraExamples ?? new Set<string>())].slice(0, 12),
        candidateAppearCount: info?.count ?? 0,
        sourcePools: [...(info?.sourcePools ?? new Set<string>())].slice(0, 40),
      };
    })
    .sort((a, b) => b.candidateAppearCount - a.candidateAppearCount || a.currentDisplayName.localeCompare(b.currentDisplayName));

  const checkedPlayers = Number.isFinite(RESOLVE_NAME_LIMIT)
    ? missing.slice(0, Math.max(0, RESOLVE_NAME_LIMIT))
    : missing;
  const wikidataNameEntities = await fetchWikidataNameEntities(checkedPlayers.map((item) => item.wikidataQid).filter(Boolean));
  const resolved: ResolvedNameRecord[] = [];
  let zhwikiSearchAttempts = 0;
  for (const item of checkedPlayers) {
    const indexRecord = indexByQid.get(item.wikidataQid);
    const rawRecord = {
      ...(rawByQid.get(item.wikidataQid) ?? {}),
      ...(wikidataNameEntities.get(item.wikidataQid) ?? {}),
    };
    const localName = resolveFromLocal(localChineseNames, item.englishName);
    const wikidataName = wikidataZhFrom(rawRecord, indexRecord);
    const zhwikiTitle = zhwikiTitleFromEntity(rawRecord) ?? zhwikiTitleFrom(rawRecord);
    const zhwikiSearch = !localName && !wikidataName && !zhwikiTitle
      ? await zhwikiSearchTitle(item.englishName, item.nationality, zhwikiSearchAttempts++)
      : undefined;
    const auto = !localName && !wikidataName && !zhwikiTitle && !zhwikiSearch ? autoTransliterate(item.englishName, item.nationality) : undefined;

    let resolvedDisplayName = localName ?? wikidataName ?? zhwikiTitle ?? zhwikiSearch ?? auto?.displayName ?? '';
    resolvedDisplayName = simplifyChinese(resolvedDisplayName) ?? '';
    let source: NameSource = 'unresolved';
    let confidence: Confidence = 'low';
    let inferredLanguage = auto?.language ?? inferLanguage(item.nationality);
    let reason = 'No reliable Chinese name source found.';
    let canApplyByDefault = false;

    if (localName) {
      source = 'lsk-local';
      confidence = 'high';
      reason = 'Matched Chinese name from LSK local data.';
      canApplyByDefault = true;
    } else if (wikidataName) {
      source = 'wikidata-zh';
      confidence = 'high';
      reason = 'Found Chinese label in Wikidata-derived data.';
      canApplyByDefault = true;
    } else if (zhwikiTitle) {
      source = 'zhwiki-title';
      confidence = 'high';
      reason = 'Found Chinese Wikipedia sitelink title.';
      canApplyByDefault = true;
    } else if (zhwikiSearch) {
      source = 'zhwiki-search';
      confidence = 'medium';
      reason = 'Found Chinese Wikipedia search title.';
      canApplyByDefault = true;
    } else if (auto?.displayName && hasChinese(auto.displayName)) {
      source = 'auto-transliteration';
      confidence = 'low';
      reason = `Generated by ${inferredLanguage} name transliteration rules.`;
      canApplyByDefault = false;
    }

    if (resolvedDisplayName && source !== 'unresolved') {
      const suspicious = detectSuspiciousResolvedName(item.englishName, resolvedDisplayName, source);
      if (suspicious.suspiciousName) {
        canApplyByDefault = false;
        reason = `${reason} ${suspicious.reason}`.trim();
      }

      resolved.push({
        wikidataQid: item.wikidataQid,
        playerId: item.playerId,
        englishName: item.englishName,
        currentDisplayName: item.currentDisplayName,
        resolvedDisplayName,
        source,
        confidence,
        nationality: item.nationality,
        inferredLanguage,
        reason,
        clubEraExamples: item.clubEraExamples,
        candidateAppearCount: item.candidateAppearCount,
        canApplyByDefault,
        suspiciousName: suspicious.suspiciousName,
        suspiciousReason: suspicious.reason,
      });
    }
  }

  const summary = {
    totalEnglishDisplayPlayers: missing.length,
    checkedPlayersCount: checkedPlayers.length,
    resolvedByLsk: resolved.filter((item) => item.source === 'lsk-local').length,
    resolvedByWikidataZh: resolved.filter((item) => item.source === 'wikidata-zh').length,
    resolvedByZhWikiTitle: resolved.filter((item) => item.source === 'zhwiki-title').length,
    resolvedByZhWikiSearch: resolved.filter((item) => item.source === 'zhwiki-search').length,
    resolvedByAutoTransliteration: resolved.filter((item) => item.source === 'auto-transliteration').length,
    canApplyByDefaultCount: resolved.filter((item) => item.canApplyByDefault).length,
    suspiciousNameCount: resolved.filter((item) => item.suspiciousName).length,
    lowConfidenceSkippedByDefaultCount: resolved.filter((item) => item.confidence === 'low' || item.source === 'auto-transliteration').length,
    unresolvedCount: checkedPlayers.length - resolved.length,
    highConfidenceCount: resolved.filter((item) => item.confidence === 'high').length,
    mediumConfidenceCount: resolved.filter((item) => item.confidence === 'medium').length,
    lowConfidenceCount: resolved.filter((item) => item.confidence === 'low').length,
    topUnresolvedPlayers: checkedPlayers
      .filter((item) => !resolved.some((resolvedItem) => resolvedItem.wikidataQid === item.wikidataQid))
      .slice(0, 100),
  };

  if (DRY_RUN) {
    console.log('Dry run only. No files were written.');
    console.log(JSON.stringify({
      summary,
      sampleUpdatesTop100: resolved.slice(0, 100).map((item) => ({
        from: item.currentDisplayName,
        to: item.resolvedDisplayName,
        source: item.source,
        confidence: item.confidence,
        canApplyByDefault: item.canApplyByDefault,
        suspiciousName: item.suspiciousName,
        suspiciousReason: item.suspiciousReason,
        candidateAppearCount: item.candidateAppearCount,
      })),
    }, null, 2));
    return;
  }

  await mkdir('data/enriched', { recursive: true });
  await writeFile(OUTPUT_MISSING, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: missing.length, players: missing }, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_RESOLVED, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    highConfidenceResults: resolved.filter((item) => item.confidence === 'high'),
    mediumConfidenceResults: resolved.filter((item) => item.confidence === 'medium'),
    lowConfidenceResults: resolved.filter((item) => item.confidence === 'low'),
    results: resolved,
  }, null, 2)}\n`, 'utf8');
  console.log('Missing Chinese name resolution complete.');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
