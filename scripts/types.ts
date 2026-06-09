import type { ClubOption, ClubSpell, Era, NormalizedPosition, Player, TeamEraTag } from '../src/types';

export interface RawClubSpell {
  statementId: string;
  clubId: string;
  clubName: string;
  clubCnName?: string;
  fromTime?: string;
  toTime?: string;
  fromYear?: number;
  toYear?: number;
}

export interface RawPlayerRecord {
  id: string;
  name?: string;
  cnName?: string;
  birthDate?: string;
  nationality?: string;
  positions: string[];
  clubs: RawClubSpell[];
  sitelinks?: number;
}

export interface RawPlayersFile {
  generatedAt: string;
  source: string;
  clubs: ClubOption[];
  count: number;
  players: RawPlayerRecord[];
  warnings: string[];
  stats?: {
    clubMode?: string;
    playersWithDatedClubHistory?: number;
    selectedPlayersByClub?: Record<string, number>;
    selectedPlayersByClubEra?: Record<string, Record<string, number>>;
  };
}

export interface NormalizedPlayersFile {
  generatedAt: string;
  source: string;
  count: number;
  players: Player[];
  stats: {
    clubMode?: string;
    totalClubSpells: number;
    totalTeamEraTags: number;
    playersWithDatedClubHistory?: number;
    lskLocalMatchedPlayers?: number;
    lowConfidencePlayers: number;
  };
}

export interface PositionMapResult {
  original: string[];
  normalized: NormalizedPosition[];
}

export interface NormalizedClubSpell extends ClubSpell {}

export interface NormalizedTeamEraTag extends TeamEraTag {
  era: Era;
}
