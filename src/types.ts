export type Era = '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s';

export type NormalizedPosition =
  | 'GK'
  | 'LB'
  | 'CB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'CDM'
  | 'CM'
  | 'CAM'
  | 'LM'
  | 'RM'
  | 'LF'
  | 'RF'
  | 'ST';

export type GameMode = 'random' | 'singleClub';

export interface ClubOption {
  clubId: string;
  clubName: string;
  clubCnName?: string;
  wikidataQid: string;
  country: string;
  displayOrder: number;
}

export interface ClubSpell {
  clubId: string;
  clubName: string;
  clubCnName?: string;
  fromYear?: number;
  toYear?: number;
}

export interface TeamEraTag {
  clubId: string;
  clubName: string;
  clubCnName?: string;
  era: Era;
  fromYear?: number;
  toYear?: number;
  yearsInEra: number;
  weight: number;
}

export interface Player {
  id: string;
  name: string;
  cnName?: string;
  displayName: string;
  nationality?: string;
  birthYear?: number;
  positions: string[];
  normalizedPositions: NormalizedPosition[];
  clubs: ClubSpell[];
  teamEraTags: TeamEraTag[];
  rating: number;
  confidence: number;
  sitelinks?: number;
}

export interface PlayerCandidate {
  playerId: string;
  displayName: string;
  name: string;
  cnName?: string;
  nationality?: string;
  clubId: string;
  clubName: string;
  clubCnName?: string;
  era: Era;
  position: NormalizedPosition;
  originalPositions: string[];
  normalizedPositions?: NormalizedPosition[];
  rating: number;
  periodRating?: number;
  periodTag?: string;
  confidence: number;
  weight: number;
  yearsInEra: number;
}

export interface PositionPoolMeta {
  key: string;
  clubKey: string;
  clubName?: string;
  clubCnName?: string;
  era: Era;
  position: NormalizedPosition;
  candidateCount: number;
  strictCount: number;
  relaxedCount: number;
  isPlayable: boolean;
}

export interface ClubEraPool {
  clubKey: string;
  clubName: string;
  clubCnName?: string;
  era: Era;
  players: PlayerCandidate[];
  totalPlayers: number;
  positionCoverage: Record<NormalizedPosition, number>;
  lineCoverage: Record<FormationLine, number>;
  playablePositions: NormalizedPosition[];
  lowPositions: NormalizedPosition[];
  sourceQuality: 'high' | 'medium' | 'low';
  dataConfidence: number;
}

export interface SquadPools {
  generatedAt: string;
  source?: string;
  clubs: ClubOption[];
  eras: Era[];
  positions: NormalizedPosition[];
  pools: Record<string, PlayerCandidate[]>;
  relaxedPools?: Record<string, PlayerCandidate[]>;
  clubEraPools?: Record<string, ClubEraPool>;
  positionPoolMeta?: Record<string, PositionPoolMeta>;
  stats: {
    clubMode?: string;
    totalPlayers: number;
    totalCandidates: number;
    generatedPeriodCandidates?: number;
    strictPoolCount?: number;
    playablePoolCount?: number;
    playablePoolsByEra?: Record<string, number>;
    playablePoolsByPosition?: Record<string, number>;
    playablePoolsByClub?: Record<string, number>;
    lowCandidatePoolsByEra?: Record<string, number>;
    lowCandidatePoolsByPosition?: Record<string, number>;
    lowCandidatePoolsByClub?: Record<string, number>;
    strictPlayablePoolCount?: number;
    relaxedPlayablePoolCount?: number;
    positionsUsingRelaxedFallback?: Record<string, number>;
    lowCandidatePoolsAfterRelaxed?: number;
    clubEraCoverage?: Record<string, {
      totalPlayers: number;
      GK: number;
      DEF: number;
      MID: number;
      ATT: number;
      playablePositions: NormalizedPosition[];
      lowPositions: NormalizedPosition[];
      sourceQuality: string;
    }>;
    topPoolsByCandidateCount?: Array<{ key: string; count: number }>;
    playersWithDatedClubHistory?: number;
    poolCount: number;
    emptyPoolCount: number;
  };
}

export interface SquadSlot {
  slotId: string;
  label: NormalizedPosition;
  displayPosition: NormalizedPosition;
  position: NormalizedPosition;
  line: FormationLine;
  acceptedPositions: NormalizedPosition[];
  clubId: string;
  clubName: string;
  clubCnName?: string;
  era: Era;
  x: number;
  y: number;
}

export type FormationLine = 'GK' | 'DEF' | 'MID' | 'ATT';

export interface FormationSlotConfig {
  slotId: string;
  displayPosition: NormalizedPosition;
  line: FormationLine;
  x: number;
  y: number;
  acceptedPositions: NormalizedPosition[];
}

export interface FormationConfig {
  formationId: string;
  name: string;
  description: string;
  slots: FormationSlotConfig[];
}

export interface SlotSelection {
  slotId: string;
  candidate: PlayerCandidate;
}

export interface SquadScores {
  attackScore: number;
  midfieldScore: number;
  defenseScore: number;
  goalkeeperScore: number;
  chemistryScore: number;
  eraBalanceScore: number;
  overallScore: number;
}

export interface MatchRecord {
  wins: number;
  draws: number;
  losses: number;
}

export interface SquadResult {
  scores: SquadScores;
  record: MatchRecord;
  grade: string;
  gradeText: string;
  corePlayers: PlayerCandidate[];
  formationId: string;
  formationName: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  mode: GameMode;
  formationId?: string;
  formationName?: string;
  record: MatchRecord;
  grade: string;
  gradeText: string;
  overallScore: number;
  corePlayers: PlayerCandidate[];
}
