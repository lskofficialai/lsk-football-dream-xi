import { copyFile, readFile, writeFile } from 'node:fs/promises';

type UnknownRecord = Record<string, unknown>;

const PLAYERS_FILE = 'public/data/players.json';
const POOLS_FILE = 'public/data/squadPools.json';
const INDEX_FILE = 'data/enriched/lsk_ai_player_index.json';
const AUTO_RESOLVED_FILE = 'data/enriched/auto_resolved_chinese_names.json';
const MANUAL_OVERRIDES_FILE = 'data/enriched/manual_name_overrides.json';
const ALLOWED_NAME_FIELDS = new Set(['displayName', 'cnName', 'nameSource', 'originalDisplayName']);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.APPLY_NAMES_DRY_RUN === '1';
const APPLY_LOW_CONFIDENCE_NAMES = process.env.APPLY_LOW_CONFIDENCE_NAMES === '1';
const DEFAULT_ALLOWED_AUTO_SOURCES = new Set(['lsk-local', 'wikidata-zh', 'zhwiki-title', 'zhwiki-search']);

interface NameSyncStats {
  updatedPlayersCount: number;
  updatedCandidatesCount: number;
  autoTransliterationUpdateCount: number;
  highConfidenceUpdateCount: number;
  englishToChineseCount: number;
  traditionalToSimplifiedCount: number;
  unchangedCount: number;
  missingEnrichedNameCount: number;
  canApplyByDefaultCount: number;
  canApplyAlreadySameCount: number;
  canApplyWouldChangeCount: number;
  canApplyNotMatchedToPublicDataCount: number;
  canApplyMatchedByQidCount: number;
  canApplyMatchedByPlayerIdCount: number;
  canApplyMatchedByNameCount: number;
  suspiciousNameCount: number;
  lowConfidenceSkippedByDefaultCount: number;
  sampleCanApplyAlreadySameTop50: CanApplyDiagnostic[];
  sampleCanApplyWouldChangeTop50: CanApplyDiagnostic[];
  sampleCanApplyNotMatchedTop50: CanApplyDiagnostic[];
  suspiciousNamesTop100: NamePreview[];
  skippedLowConfidenceTop100: NamePreview[];
  sampleAutoTransliterationUpdatesTop100: NameUpdateSample[];
  sampleHighConfidenceUpdatesTop100: NameUpdateSample[];
  skippedPlayersOutsideCandidatePoolCount: number;
  sampleSkippedPlayersOutsideCandidatePoolTop50: NamePreview[];
  candidateAndPoolCountsUnchanged: boolean;
  playersOnlyNameFieldsChanged: boolean;
  squadPoolsOnlyNameFieldsChanged: boolean;
  lowConfidenceMode: boolean;
  candidatePoolPlayerIdCount: number;
  candidatePoolQidCount: number;
  candidatePoolNameCount: number;
  sampleUpdatesTop100: NameUpdateSample[];
}

interface NameUpdateSample {
  kind: 'player' | 'candidate';
  playerId?: string;
  wikidataQid?: string;
  clubId?: string;
  era?: string;
  position?: string;
  englishName: string;
  currentDisplayName: string;
  resolvedDisplayName: string;
  source: string;
  confidence?: string;
  reason?: string;
  clubEraExamples: string[];
  candidateAppearCount: number;
}

interface CanApplyDiagnostic {
  wikidataQid?: string;
  playerId?: string;
  englishName: string;
  currentDisplayNameInPublicData?: string;
  resolvedDisplayName: string;
  matchMethod: 'wikidataQid' | 'playerId' | 'name' | 'none';
  source: string;
  confidence?: string;
  candidateAppearCount: number;
  clubEraExamples: string[];
}

interface PublicNameTarget {
  qids: string[];
  playerIds: string[];
  nameKeys: string[];
  currentDisplayName?: string;
}

interface CandidatePoolIdentity {
  qids: Set<string>;
  playerIds: Set<string>;
  nameKeys: Set<string>;
}

interface NamePreview {
  wikidataQid?: string;
  playerId?: string;
  englishName: string;
  currentDisplayName: string;
  resolvedDisplayName: string;
  source: string;
  confidence?: string;
  reason?: string;
  clubEraExamples: string[];
  candidateAppearCount: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function readOptionalJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return [];
  }
}

function rowsFromJson(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.results)) return value.results.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.players)) return value.players.filter(isRecord);
  return [];
}

function hasChinese(value?: string): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

function normalizeLooseName(value?: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function detectSuspiciousResolvedName(row: UnknownRecord, displayName: string, source: string): { suspiciousName: boolean; reason?: string } {
  if (source === 'manual-override' || source === 'lsk-local' || source === 'auto-transliteration') return { suspiciousName: false };
  if (SHORT_NAME_WHITELIST.has(displayName)) return { suspiciousName: false };

  const compactName = compactChineseName(displayName);
  const englishName = stringValue(row.englishName) ?? stringValue(row.name) ?? stringValue(row.currentDisplayName) ?? '';
  const englishTokenCount = englishName.split(/[\s.'’,-]+/).filter(Boolean).length;
  const chinesePartCount = displayName.split(/[·\s]+/).filter(Boolean).length;

  if (/消歧义|消歧義|列表|页面|頁面|昵称|暱稱/.test(displayName)) {
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

function structuralCloneWithoutNameFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuralCloneWithoutNameFields);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !ALLOWED_NAME_FIELDS.has(key))
      .map(([key, child]) => [key, structuralCloneWithoutNameFields(child)]),
  );
}

function structuralSignature(value: unknown): string {
  return JSON.stringify(structuralCloneWithoutNameFields(value));
}

function candidateCountSignature(squadPools: UnknownRecord): string {
  const pools = isRecord(squadPools.pools) ? squadPools.pools : {};
  const relaxedPools = isRecord(squadPools.relaxedPools) ? squadPools.relaxedPools : {};
  const counts = (source: UnknownRecord) =>
    Object.fromEntries(
      Object.entries(source)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, Array.isArray(value) ? value.length : -1]),
    );
  const stats = isRecord(squadPools.stats) ? squadPools.stats : {};
  return JSON.stringify({
    poolKeys: Object.keys(pools).sort(),
    relaxedPoolKeys: Object.keys(relaxedPools).sort(),
    poolCounts: counts(pools),
    relaxedPoolCounts: counts(relaxedPools),
    playablePoolCount: stats.playablePoolCount,
    strictPlayablePoolCount: stats.strictPlayablePoolCount,
    relaxedPlayablePoolCount: stats.relaxedPlayablePoolCount,
    clubEraPoolCount: isRecord(squadPools.clubEraPools) ? Object.keys(squadPools.clubEraPools).length : 0,
  });
}

function namePriority(row: UnknownRecord, fallbackPriority: number): number {
  const source = stringValue(row.nameSource) ?? stringValue(row.source);
  if (source === 'manual-override') return 100;
  if (source === 'lsk-local') return 90;
  if (source?.startsWith('wikidata-zh')) return 80;
  if (source === 'zhwiki-title') return 70;
  if (source === 'zhwiki-search') return 60;
  if (source === 'auto-transliteration') return 40;
  return fallbackPriority;
}

function namePreview(row: UnknownRecord, displayName: string, source: string, reason?: string): NamePreview {
  return {
    wikidataQid: stringValue(row.wikidataQid),
    playerId: stringValue(row.playerId) ?? stringValue(row.lskPlayerId),
    englishName: stringValue(row.englishName) ?? stringValue(row.name) ?? stringValue(row.currentDisplayName) ?? '',
    currentDisplayName: stringValue(row.currentDisplayName) ?? stringValue(row.displayName) ?? '',
    resolvedDisplayName: displayName,
    source,
    confidence: stringValue(row.confidence),
    reason: reason ?? stringValue(row.reason),
    clubEraExamples: arrayOfStrings(row.clubEraExamples),
    candidateAppearCount: typeof row.candidateAppearCount === 'number' ? row.candidateAppearCount : 0,
  };
}

function canApplyDiagnostic(row: UnknownRecord, matchMethod: CanApplyDiagnostic['matchMethod'], currentDisplayNameInPublicData?: string): CanApplyDiagnostic {
  return {
    wikidataQid: stringValue(row.wikidataQid),
    playerId: stringValue(row.playerId) ?? stringValue(row.lskPlayerId),
    englishName: stringValue(row.englishName) ?? stringValue(row.name) ?? stringValue(row.currentDisplayName) ?? '',
    currentDisplayNameInPublicData,
    resolvedDisplayName: stringValue(row.displayName) ?? stringValue(row.resolvedDisplayName) ?? '',
    matchMethod,
    source: stringValue(row.nameSource) ?? stringValue(row.source) ?? 'enriched',
    confidence: stringValue(row.confidence),
    candidateAppearCount: typeof row.candidateAppearCount === 'number' ? row.candidateAppearCount : 0,
    clubEraExamples: arrayOfStrings(row.clubEraExamples),
  };
}

function normalizedNameRow(row: UnknownRecord, fallbackPriority: number, stats?: NameSyncStats): UnknownRecord | undefined {
  const displayName = stringValue(row.displayName) ?? stringValue(row.resolvedDisplayName);
  if (!displayName || !hasChinese(displayName)) return undefined;
  const source = stringValue(row.nameSource) ?? stringValue(row.source) ?? 'enriched';
  const confidence = stringValue(row.confidence);
  const canApplyByDefault = row.canApplyByDefault === true || DEFAULT_ALLOWED_AUTO_SOURCES.has(source);
  const isLowConfidence = confidence === 'low' || source === 'auto-transliteration' || row.canApplyByDefault === false;
  const isAllowedLowConfidence = APPLY_LOW_CONFIDENCE_NAMES && source === 'auto-transliteration' && confidence === 'low';
  const suspicious = row.suspiciousName === true
    ? { suspiciousName: true, reason: stringValue(row.suspiciousReason) ?? stringValue(row.reason) ?? 'resolved name may be suspicious' }
    : detectSuspiciousResolvedName(row, displayName, source);

  if (stats) {
    if (isLowConfidence) {
      stats.lowConfidenceSkippedByDefaultCount += 1;
      if (stats.skippedLowConfidenceTop100.length < 100) {
        stats.skippedLowConfidenceTop100.push(namePreview(row, displayName, source, stringValue(row.reason)));
      }
    } else if (suspicious.suspiciousName) {
      stats.suspiciousNameCount += 1;
      if (stats.suspiciousNamesTop100.length < 100) {
        stats.suspiciousNamesTop100.push(namePreview(row, displayName, source, suspicious.reason));
      }
    } else if (canApplyByDefault) {
      stats.canApplyByDefaultCount += 1;
    }
  }

  if (suspicious.suspiciousName) return undefined;
  if (!isAllowedLowConfidence && (!canApplyByDefault || isLowConfidence)) return undefined;
  return {
    ...row,
    displayName,
    nameSource: source,
    suspiciousName: suspicious.suspiciousName,
    suspiciousReason: suspicious.reason,
    priority: namePriority(row, fallbackPriority),
  };
}

function setBestName(target: Map<string, UnknownRecord>, key: string | undefined, row: UnknownRecord) {
  if (!key) return;
  const existing = target.get(key);
  const existingPriority = typeof existing?.priority === 'number' ? existing.priority : -1;
  const nextPriority = typeof row.priority === 'number' ? row.priority : 0;
  if (!existing || nextPriority >= existingPriority) target.set(key, row);
}

function buildNameIndex(indexRows: UnknownRecord[], autoResolvedRows: UnknownRecord[], manualRows: UnknownRecord[], stats: NameSyncStats) {
  const byQid = new Map<string, UnknownRecord>();
  const byLskId = new Map<string, UnknownRecord>();
  const canApplyRows: UnknownRecord[] = [];
  const addRows = (rows: UnknownRecord[], fallbackPriority: number, collectStats = false) => rows.forEach((row) => {
    const normalized = normalizedNameRow(row, fallbackPriority, collectStats ? stats : undefined);
    if (!normalized) return;
    if (collectStats) canApplyRows.push(normalized);
    const qid = stringValue(row.wikidataQid);
    const lskPlayerId = stringValue(row.lskPlayerId);
    setBestName(byQid, qid, normalized);
    setBestName(byLskId, lskPlayerId, normalized);
  });

  addRows(indexRows, 50);
  addRows(autoResolvedRows, 40, true);
  addRows(manualRows, 100);
  return { byQid, byLskId, canApplyRows };
}

function collectPublicNameTargets(playersFile: UnknownRecord, poolsFile: UnknownRecord): PublicNameTarget[] {
  const targets: PublicNameTarget[] = [];
  const addTarget = (record: unknown) => {
    if (!isRecord(record)) return;
    const qids = [
      stringValue(record.wikidataQid),
      stringValue(record.id),
      stringValue(record.playerId),
    ].filter((value): value is string => Boolean(value));
    const playerIds = [
      stringValue(record.playerId),
      stringValue(record.id),
      stringValue(record.lskPlayerId),
    ].filter((value): value is string => Boolean(value));
    const nameKeys = [
      stringValue(record.displayName),
      stringValue(record.name),
      stringValue(record.cnName),
      stringValue(record.originalDisplayName),
    ].map(normalizeLooseName).filter((value): value is string => Boolean(value));

    targets.push({
      qids: [...new Set(qids)],
      playerIds: [...new Set(playerIds)],
      nameKeys: [...new Set(nameKeys)],
      currentDisplayName: stringValue(record.displayName),
    });
  };

  if (Array.isArray(playersFile.players)) playersFile.players.forEach(addTarget);
  const addPools = (source: unknown) => {
    if (!isRecord(source)) return;
    Object.values(source).forEach((pool) => {
      if (Array.isArray(pool)) pool.forEach(addTarget);
    });
  };
  addPools(poolsFile.pools);
  addPools(poolsFile.relaxedPools);
  if (isRecord(poolsFile.clubEraPools)) {
    Object.values(poolsFile.clubEraPools).forEach((clubEraPool) => {
      if (isRecord(clubEraPool) && Array.isArray(clubEraPool.players)) clubEraPool.players.forEach(addTarget);
    });
  }
  return targets;
}

function identityParts(record: UnknownRecord) {
  return {
    qids: [
      stringValue(record.wikidataQid),
      stringValue(record.id),
      stringValue(record.playerId),
    ].filter((value): value is string => Boolean(value)),
    playerIds: [
      stringValue(record.playerId),
      stringValue(record.id),
      stringValue(record.lskPlayerId),
    ].filter((value): value is string => Boolean(value)),
    nameKeys: [
      stringValue(record.displayName),
      stringValue(record.name),
      stringValue(record.cnName),
      stringValue(record.originalDisplayName),
    ].map(normalizeLooseName).filter((value): value is string => Boolean(value)),
  };
}

function collectCandidatePoolIdentity(poolsFile: UnknownRecord): CandidatePoolIdentity {
  const identity: CandidatePoolIdentity = {
    qids: new Set(),
    playerIds: new Set(),
    nameKeys: new Set(),
  };
  const addCandidate = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const parts = identityParts(candidate);
    parts.qids.forEach((qid) => identity.qids.add(qid));
    parts.playerIds.forEach((playerId) => identity.playerIds.add(playerId));
    parts.nameKeys.forEach((nameKey) => identity.nameKeys.add(nameKey));
  };
  const addPools = (source: unknown) => {
    if (!isRecord(source)) return;
    Object.values(source).forEach((pool) => {
      if (Array.isArray(pool)) pool.forEach(addCandidate);
    });
  };

  addPools(poolsFile.pools);
  addPools(poolsFile.relaxedPools);
  if (isRecord(poolsFile.clubEraPools)) {
    Object.values(poolsFile.clubEraPools).forEach((clubEraPool) => {
      if (isRecord(clubEraPool) && Array.isArray(clubEraPool.players)) clubEraPool.players.forEach(addCandidate);
    });
  }
  return identity;
}

function recordAppearsInCandidatePool(record: UnknownRecord, identity: CandidatePoolIdentity): boolean {
  const parts = identityParts(record);
  return parts.qids.some((qid) => identity.qids.has(qid))
    || parts.playerIds.some((playerId) => identity.playerIds.has(playerId))
    || parts.nameKeys.some((nameKey) => identity.nameKeys.has(nameKey));
}

function analyzeCanApplyRows(canApplyRows: UnknownRecord[], publicTargets: PublicNameTarget[], stats: NameSyncStats) {
  const targetsByQid = new Map<string, PublicNameTarget[]>();
  const targetsByPlayerId = new Map<string, PublicNameTarget[]>();
  const targetsByName = new Map<string, PublicNameTarget[]>();
  const push = (map: Map<string, PublicNameTarget[]>, key: string, target: PublicNameTarget) => {
    const list = map.get(key);
    if (list) list.push(target);
    else map.set(key, [target]);
  };

  publicTargets.forEach((target) => {
    target.qids.forEach((qid) => push(targetsByQid, qid, target));
    target.playerIds.forEach((playerId) => push(targetsByPlayerId, playerId, target));
    target.nameKeys.forEach((nameKey) => push(targetsByName, nameKey, target));
  });

  canApplyRows.forEach((row) => {
    const qid = stringValue(row.wikidataQid);
    const playerId = stringValue(row.playerId) ?? stringValue(row.lskPlayerId);
    const nameKeys = [
      stringValue(row.currentDisplayName),
      stringValue(row.englishName),
      stringValue(row.name),
    ].map(normalizeLooseName).filter((value): value is string => Boolean(value));
    let matchMethod: CanApplyDiagnostic['matchMethod'] = 'none';
    let matches: PublicNameTarget[] = [];

    if (qid && targetsByQid.has(qid)) {
      matchMethod = 'wikidataQid';
      matches = targetsByQid.get(qid) ?? [];
      stats.canApplyMatchedByQidCount += 1;
    } else if (playerId && targetsByPlayerId.has(playerId)) {
      matchMethod = 'playerId';
      matches = targetsByPlayerId.get(playerId) ?? [];
      stats.canApplyMatchedByPlayerIdCount += 1;
    } else {
      for (const nameKey of nameKeys) {
        if (targetsByName.has(nameKey)) {
          matchMethod = 'name';
          matches = targetsByName.get(nameKey) ?? [];
          stats.canApplyMatchedByNameCount += 1;
          break;
        }
      }
    }

    const nextName = stringValue(row.displayName) ?? stringValue(row.resolvedDisplayName) ?? '';
    const firstDifferent = matches.find((target) => target.currentDisplayName && target.currentDisplayName !== nextName);
    const firstSame = matches.find((target) => target.currentDisplayName === nextName);
    const firstMatch = firstDifferent ?? firstSame ?? matches[0];

    if (matches.length === 0) {
      stats.canApplyNotMatchedToPublicDataCount += 1;
      if (stats.sampleCanApplyNotMatchedTop50.length < 50) {
        stats.sampleCanApplyNotMatchedTop50.push(canApplyDiagnostic(row, 'none'));
      }
      return;
    }

    if (firstDifferent) {
      stats.canApplyWouldChangeCount += 1;
      if (stats.sampleCanApplyWouldChangeTop50.length < 50) {
        stats.sampleCanApplyWouldChangeTop50.push(canApplyDiagnostic(row, matchMethod, firstDifferent.currentDisplayName));
      }
      return;
    }

    stats.canApplyAlreadySameCount += 1;
    if (stats.sampleCanApplyAlreadySameTop50.length < 50) {
      stats.sampleCanApplyAlreadySameTop50.push(canApplyDiagnostic(row, matchMethod, firstMatch?.currentDisplayName));
    }
  });
}

function maybeApplyName(target: UnknownRecord, enriched: UnknownRecord | undefined, stats: NameSyncStats, kind: 'player' | 'candidate') {
  const nextName = stringValue(enriched?.displayName);
  if (!nextName) {
    stats.missingEnrichedNameCount += 1;
    return;
  }

  const currentName = stringValue(target.displayName);
  if (!currentName || currentName === nextName) {
    stats.unchangedCount += 1;
    return;
  }

  if (!target.originalDisplayName) target.originalDisplayName = currentName;
  target.displayName = nextName;
  target.cnName = hasChinese(nextName) ? nextName : target.cnName;
  target.nameSource = stringValue(enriched?.nameSource) ?? 'enriched';

  if (!hasChinese(currentName) && hasChinese(nextName)) stats.englishToChineseCount += 1;
  if (currentName !== nextName && hasChinese(currentName) && hasChinese(nextName)) stats.traditionalToSimplifiedCount += 1;
  if (kind === 'player') stats.updatedPlayersCount += 1;
  if (kind === 'candidate') stats.updatedCandidatesCount += 1;
  const source = stringValue(enriched?.nameSource) ?? stringValue(enriched?.source) ?? 'enriched';
  const confidence = stringValue(enriched?.confidence);
  const sample: NameUpdateSample = {
    kind,
    playerId: stringValue(target.id) ?? stringValue(target.playerId) ?? stringValue(target.wikidataQid),
    wikidataQid: stringValue(target.id) ?? stringValue(target.wikidataQid) ?? stringValue(target.playerId),
    clubId: stringValue(target.clubId),
    era: stringValue(target.era),
    position: stringValue(target.position),
    englishName: stringValue(enriched?.englishName) ?? stringValue(target.name) ?? currentName,
    currentDisplayName: currentName,
    resolvedDisplayName: nextName,
    source,
    confidence,
    reason: stringValue(enriched?.reason),
    clubEraExamples: arrayOfStrings(enriched?.clubEraExamples),
    candidateAppearCount: typeof enriched?.candidateAppearCount === 'number' ? enriched.candidateAppearCount : 0,
  };

  if (source === 'auto-transliteration' && confidence === 'low') {
    stats.autoTransliterationUpdateCount += 1;
    if (stats.sampleAutoTransliterationUpdatesTop100.length < 100) {
      stats.sampleAutoTransliterationUpdatesTop100.push(sample);
    }
  } else {
    stats.highConfidenceUpdateCount += 1;
    if (stats.sampleHighConfidenceUpdatesTop100.length < 100) {
      stats.sampleHighConfidenceUpdatesTop100.push(sample);
    }
  }

  if (stats.sampleUpdatesTop100.length < 100) {
    stats.sampleUpdatesTop100.push(sample);
  }
}

async function main() {
  const indexRows = await readJson<UnknownRecord[]>(INDEX_FILE);
  const autoResolvedRows = rowsFromJson(await readOptionalJson(AUTO_RESOLVED_FILE));
  const manualRows = rowsFromJson(await readOptionalJson(MANUAL_OVERRIDES_FILE));
  const playersFile = await readJson<UnknownRecord>(PLAYERS_FILE);
  const poolsFile = await readJson<UnknownRecord>(POOLS_FILE);
  const beforePlayersSignature = structuralSignature(playersFile);
  const beforePoolsSignature = structuralSignature(poolsFile);
  const beforePoolCounts = candidateCountSignature(poolsFile);
  const candidatePoolIdentity = collectCandidatePoolIdentity(poolsFile);
  const stats: NameSyncStats = {
    updatedPlayersCount: 0,
    updatedCandidatesCount: 0,
    autoTransliterationUpdateCount: 0,
    highConfidenceUpdateCount: 0,
    englishToChineseCount: 0,
    traditionalToSimplifiedCount: 0,
    unchangedCount: 0,
    missingEnrichedNameCount: 0,
    canApplyByDefaultCount: 0,
    canApplyAlreadySameCount: 0,
    canApplyWouldChangeCount: 0,
    canApplyNotMatchedToPublicDataCount: 0,
    canApplyMatchedByQidCount: 0,
    canApplyMatchedByPlayerIdCount: 0,
    canApplyMatchedByNameCount: 0,
    suspiciousNameCount: 0,
    lowConfidenceSkippedByDefaultCount: 0,
    sampleCanApplyAlreadySameTop50: [],
    sampleCanApplyWouldChangeTop50: [],
    sampleCanApplyNotMatchedTop50: [],
    suspiciousNamesTop100: [],
    skippedLowConfidenceTop100: [],
    sampleAutoTransliterationUpdatesTop100: [],
    sampleHighConfidenceUpdatesTop100: [],
    skippedPlayersOutsideCandidatePoolCount: 0,
    sampleSkippedPlayersOutsideCandidatePoolTop50: [],
    candidateAndPoolCountsUnchanged: true,
    playersOnlyNameFieldsChanged: true,
    squadPoolsOnlyNameFieldsChanged: true,
    lowConfidenceMode: APPLY_LOW_CONFIDENCE_NAMES,
    candidatePoolPlayerIdCount: candidatePoolIdentity.playerIds.size,
    candidatePoolQidCount: candidatePoolIdentity.qids.size,
    candidatePoolNameCount: candidatePoolIdentity.nameKeys.size,
    sampleUpdatesTop100: [],
  };
  const { byQid, byLskId, canApplyRows } = buildNameIndex(indexRows, autoResolvedRows, manualRows, stats);
  analyzeCanApplyRows(canApplyRows, collectPublicNameTargets(playersFile, poolsFile), stats);

  if (Array.isArray(playersFile.players)) {
    playersFile.players.filter(isRecord).forEach((player) => {
      const qid = stringValue(player.id) ?? stringValue(player.wikidataQid);
      const lskPlayerId = stringValue(player.lskPlayerId);
      const enriched = (qid ? byQid.get(qid) : undefined) ?? (lskPlayerId ? byLskId.get(lskPlayerId) : undefined);
      if (APPLY_LOW_CONFIDENCE_NAMES && !recordAppearsInCandidatePool(player, candidatePoolIdentity)) {
        if (enriched) {
          stats.skippedPlayersOutsideCandidatePoolCount += 1;
          if (stats.sampleSkippedPlayersOutsideCandidatePoolTop50.length < 50) {
            stats.sampleSkippedPlayersOutsideCandidatePoolTop50.push(namePreview(enriched, stringValue(enriched.displayName) ?? '', stringValue(enriched.nameSource) ?? stringValue(enriched.source) ?? 'enriched'));
          }
        }
        return;
      }
      maybeApplyName(player, enriched, stats, 'player');
    });
  }

  const patchCandidate = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const qid = stringValue(candidate.playerId) ?? stringValue(candidate.wikidataQid);
    const lskPlayerId = stringValue(candidate.lskPlayerId);
    maybeApplyName(candidate, (qid ? byQid.get(qid) : undefined) ?? (lskPlayerId ? byLskId.get(lskPlayerId) : undefined), stats, 'candidate');
  };

  const patchPools = (source: unknown) => {
    if (!isRecord(source)) return;
    Object.values(source).forEach((pool) => {
      if (Array.isArray(pool)) pool.forEach(patchCandidate);
    });
  };

  patchPools(poolsFile.pools);
  patchPools(poolsFile.relaxedPools);
  if (isRecord(poolsFile.clubEraPools)) {
    Object.values(poolsFile.clubEraPools).forEach((clubEraPool) => {
      if (isRecord(clubEraPool) && Array.isArray(clubEraPool.players)) clubEraPool.players.forEach(patchCandidate);
    });
  }

  stats.playersOnlyNameFieldsChanged = beforePlayersSignature === structuralSignature(playersFile);
  stats.squadPoolsOnlyNameFieldsChanged = beforePoolsSignature === structuralSignature(poolsFile);
  stats.candidateAndPoolCountsUnchanged = beforePoolCounts === candidateCountSignature(poolsFile);

  if (!stats.playersOnlyNameFieldsChanged) {
    throw new Error('Aborted: players.json changed outside allowed name fields.');
  }
  if (!stats.squadPoolsOnlyNameFieldsChanged) {
    throw new Error('Aborted: squadPools.json changed outside allowed name fields.');
  }
  if (!stats.candidateAndPoolCountsUnchanged) {
    throw new Error('Aborted: squad pool keys, candidate counts, playable counts, or clubEraPools count changed.');
  }

  if (DRY_RUN) {
    const dryRunStats = {
      wouldUpdatePlayersCount: stats.updatedPlayersCount,
      wouldUpdateCandidatesCount: stats.updatedCandidatesCount,
      autoTransliterationUpdateCount: stats.autoTransliterationUpdateCount,
      highConfidenceUpdateCount: stats.highConfidenceUpdateCount,
      englishToChineseCount: stats.englishToChineseCount,
      traditionalToSimplifiedCount: stats.traditionalToSimplifiedCount,
      unchangedCount: stats.unchangedCount,
      missingEnrichedNameCount: stats.missingEnrichedNameCount,
      canApplyByDefaultCount: stats.canApplyByDefaultCount,
      canApplyAlreadySameCount: stats.canApplyAlreadySameCount,
      canApplyWouldChangeCount: stats.canApplyWouldChangeCount,
      canApplyNotMatchedToPublicDataCount: stats.canApplyNotMatchedToPublicDataCount,
      canApplyMatchedByQidCount: stats.canApplyMatchedByQidCount,
      canApplyMatchedByPlayerIdCount: stats.canApplyMatchedByPlayerIdCount,
      canApplyMatchedByNameCount: stats.canApplyMatchedByNameCount,
      suspiciousNameCount: stats.suspiciousNameCount,
      lowConfidenceSkippedByDefaultCount: stats.lowConfidenceSkippedByDefaultCount,
      candidateAndPoolCountsUnchanged: stats.candidateAndPoolCountsUnchanged,
      playersOnlyNameFieldsChanged: stats.playersOnlyNameFieldsChanged,
      squadPoolsOnlyNameFieldsChanged: stats.squadPoolsOnlyNameFieldsChanged,
      lowConfidenceMode: stats.lowConfidenceMode,
      candidatePoolPlayerIdCount: stats.candidatePoolPlayerIdCount,
      candidatePoolQidCount: stats.candidatePoolQidCount,
      candidatePoolNameCount: stats.candidatePoolNameCount,
      skippedPlayersOutsideCandidatePoolCount: stats.skippedPlayersOutsideCandidatePoolCount,
      sampleCanApplyAlreadySameTop50: stats.sampleCanApplyAlreadySameTop50,
      sampleCanApplyWouldChangeTop50: stats.sampleCanApplyWouldChangeTop50,
      sampleCanApplyNotMatchedTop50: stats.sampleCanApplyNotMatchedTop50,
      sampleAutoTransliterationUpdatesTop100: stats.sampleAutoTransliterationUpdatesTop100,
      sampleHighConfidenceUpdatesTop100: stats.sampleHighConfidenceUpdatesTop100,
      sampleSkippedPlayersOutsideCandidatePoolTop50: stats.sampleSkippedPlayersOutsideCandidatePoolTop50,
      suspiciousNamesTop100: stats.suspiciousNamesTop100,
      skippedLowConfidenceTop100: stats.skippedLowConfidenceTop100,
      sampleUpdatesTop100: stats.sampleUpdatesTop100,
    };
    console.log('Dry run only. No files were written.');
    console.log(JSON.stringify(dryRunStats, null, 2));
    return;
  }

  await copyFile(PLAYERS_FILE, APPLY_LOW_CONFIDENCE_NAMES ? 'public/data/players.before-auto-transliteration.json' : 'public/data/players.before-names-sync.json');
  await copyFile(POOLS_FILE, APPLY_LOW_CONFIDENCE_NAMES ? 'public/data/squadPools.before-auto-transliteration.json' : 'public/data/squadPools.before-names-sync.json');
  await writeFile(PLAYERS_FILE, `${JSON.stringify(playersFile, null, 2)}\n`, 'utf8');
  await writeFile(POOLS_FILE, `${JSON.stringify(poolsFile, null, 2)}\n`, 'utf8');

  console.log('Applied enriched names to game data.');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
