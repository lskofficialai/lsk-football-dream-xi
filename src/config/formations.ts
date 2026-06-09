import type { FormationConfig, NormalizedPosition } from '../types';

export const ACCEPTED_POSITIONS: Record<NormalizedPosition, NormalizedPosition[]> = {
  GK: ['GK'],
  ST: ['ST', 'LF', 'RF', 'CAM'],
  LF: ['LF', 'ST', 'CAM', 'RF', 'LM'],
  RF: ['RF', 'ST', 'CAM', 'LF', 'RM'],
  CAM: ['CAM', 'CM', 'ST', 'LF', 'RF'],
  CM: ['CM', 'CDM', 'CAM', 'LM', 'RM'],
  CDM: ['CDM', 'CM', 'CB'],
  LM: ['LM', 'LF', 'CM', 'LWB'],
  RM: ['RM', 'RF', 'CM', 'RWB'],
  LB: ['LB', 'LWB', 'CB', 'LM'],
  RB: ['RB', 'RWB', 'CB', 'RM'],
  LWB: ['LWB', 'LB', 'LM', 'CB'],
  RWB: ['RWB', 'RB', 'RM', 'CB'],
  CB: ['CB', 'LB', 'RB', 'CDM'],
};

const accepted = (position: NormalizedPosition) => ACCEPTED_POSITIONS[position];

export const FORMATIONS: FormationConfig[] = [
  {
    formationId: '4-3-3',
    name: '4-3-3',
    description: '经典均衡，边锋与中锋火力充足',
    slots: [
      { slotId: 'GK', displayPosition: 'GK', line: 'GK', x: 50, y: 94, acceptedPositions: accepted('GK') },
      { slotId: 'LB', displayPosition: 'LB', line: 'DEF', x: 14, y: 68, acceptedPositions: accepted('LB') },
      { slotId: 'CB1', displayPosition: 'CB', line: 'DEF', x: 36, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'CB2', displayPosition: 'CB', line: 'DEF', x: 64, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'RB', displayPosition: 'RB', line: 'DEF', x: 86, y: 68, acceptedPositions: accepted('RB') },
      { slotId: 'CDM', displayPosition: 'CDM', line: 'MID', x: 52, y: 61, acceptedPositions: accepted('CDM') },
      { slotId: 'CM', displayPosition: 'CM', line: 'MID', x: 30, y: 46, acceptedPositions: accepted('CM') },
      { slotId: 'CAM', displayPosition: 'CAM', line: 'MID', x: 72, y: 40, acceptedPositions: accepted('CAM') },
      { slotId: 'LF', displayPosition: 'LF', line: 'ATT', x: 22, y: 23, acceptedPositions: accepted('LF') },
      { slotId: 'ST', displayPosition: 'ST', line: 'ATT', x: 50, y: 11, acceptedPositions: accepted('ST') },
      { slotId: 'RF', displayPosition: 'RF', line: 'ATT', x: 78, y: 23, acceptedPositions: accepted('RF') },
    ],
  },
  {
    formationId: '4-2-3-1',
    name: '4-2-3-1',
    description: '双后腰保护，前腰组织核心',
    slots: [
      { slotId: 'GK', displayPosition: 'GK', line: 'GK', x: 50, y: 94, acceptedPositions: accepted('GK') },
      { slotId: 'LB', displayPosition: 'LB', line: 'DEF', x: 14, y: 68, acceptedPositions: accepted('LB') },
      { slotId: 'CB1', displayPosition: 'CB', line: 'DEF', x: 36, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'CB2', displayPosition: 'CB', line: 'DEF', x: 64, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'RB', displayPosition: 'RB', line: 'DEF', x: 86, y: 68, acceptedPositions: accepted('RB') },
      { slotId: 'CDM1', displayPosition: 'CDM', line: 'MID', x: 36, y: 56, acceptedPositions: accepted('CDM') },
      { slotId: 'CDM2', displayPosition: 'CDM', line: 'MID', x: 64, y: 56, acceptedPositions: accepted('CDM') },
      { slotId: 'LM', displayPosition: 'LM', line: 'MID', x: 16, y: 30, acceptedPositions: accepted('LM') },
      { slotId: 'CAM', displayPosition: 'CAM', line: 'MID', x: 50, y: 31, acceptedPositions: accepted('CAM') },
      { slotId: 'RM', displayPosition: 'RM', line: 'MID', x: 84, y: 30, acceptedPositions: accepted('RM') },
      { slotId: 'ST', displayPosition: 'ST', line: 'ATT', x: 50, y: 11, acceptedPositions: accepted('ST') },
    ],
  },
  {
    formationId: '4-4-2',
    name: '4-4-2',
    description: '传统双前锋，边路与中路兼顾',
    slots: [
      { slotId: 'GK', displayPosition: 'GK', line: 'GK', x: 50, y: 94, acceptedPositions: accepted('GK') },
      { slotId: 'LB', displayPosition: 'LB', line: 'DEF', x: 14, y: 68, acceptedPositions: accepted('LB') },
      { slotId: 'CB1', displayPosition: 'CB', line: 'DEF', x: 36, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'CB2', displayPosition: 'CB', line: 'DEF', x: 64, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'RB', displayPosition: 'RB', line: 'DEF', x: 86, y: 68, acceptedPositions: accepted('RB') },
      { slotId: 'LM', displayPosition: 'LM', line: 'MID', x: 14, y: 34, acceptedPositions: accepted('LM') },
      { slotId: 'CM1', displayPosition: 'CM', line: 'MID', x: 35, y: 49, acceptedPositions: accepted('CM') },
      { slotId: 'CM2', displayPosition: 'CM', line: 'MID', x: 65, y: 56, acceptedPositions: accepted('CM') },
      { slotId: 'RM', displayPosition: 'RM', line: 'MID', x: 86, y: 34, acceptedPositions: accepted('RM') },
      { slotId: 'ST1', displayPosition: 'ST', line: 'ATT', x: 35, y: 13, acceptedPositions: accepted('ST') },
      { slotId: 'ST2', displayPosition: 'ST', line: 'ATT', x: 65, y: 13, acceptedPositions: accepted('ST') },
    ],
  },
  {
    formationId: '3-5-2',
    name: '3-5-2',
    description: '三中卫体系，中场人数优势',
    slots: [
      { slotId: 'GK', displayPosition: 'GK', line: 'GK', x: 50, y: 94, acceptedPositions: accepted('GK') },
      { slotId: 'CB1', displayPosition: 'CB', line: 'DEF', x: 22, y: 78, acceptedPositions: accepted('CB') },
      { slotId: 'CB2', displayPosition: 'CB', line: 'DEF', x: 50, y: 81, acceptedPositions: accepted('CB') },
      { slotId: 'CB3', displayPosition: 'CB', line: 'DEF', x: 78, y: 78, acceptedPositions: accepted('CB') },
      { slotId: 'LWB', displayPosition: 'LWB', line: 'MID', x: 14, y: 43, acceptedPositions: accepted('LWB') },
      { slotId: 'RWB', displayPosition: 'RWB', line: 'MID', x: 86, y: 43, acceptedPositions: accepted('RWB') },
      { slotId: 'CDM', displayPosition: 'CDM', line: 'MID', x: 50, y: 68, acceptedPositions: accepted('CDM') },
      { slotId: 'CM', displayPosition: 'CM', line: 'MID', x: 30, y: 55, acceptedPositions: accepted('CM') },
      { slotId: 'CAM', displayPosition: 'CAM', line: 'MID', x: 50, y: 32, acceptedPositions: accepted('CAM') },
      { slotId: 'ST1', displayPosition: 'ST', line: 'ATT', x: 35, y: 12, acceptedPositions: accepted('ST') },
      { slotId: 'ST2', displayPosition: 'ST', line: 'ATT', x: 65, y: 12, acceptedPositions: accepted('ST') },
    ],
  },
  {
    formationId: '5-2-3',
    name: '5-2-3',
    description: '五后卫反击，防守稳但前场仍有速度',
    slots: [
      { slotId: 'GK', displayPosition: 'GK', line: 'GK', x: 50, y: 94, acceptedPositions: accepted('GK') },
      { slotId: 'LWB', displayPosition: 'LWB', line: 'DEF', x: 14, y: 63, acceptedPositions: accepted('LWB') },
      { slotId: 'CB1', displayPosition: 'CB', line: 'DEF', x: 22, y: 76, acceptedPositions: accepted('CB') },
      { slotId: 'CB2', displayPosition: 'CB', line: 'DEF', x: 50, y: 82, acceptedPositions: accepted('CB') },
      { slotId: 'CB3', displayPosition: 'CB', line: 'DEF', x: 78, y: 80, acceptedPositions: accepted('CB') },
      { slotId: 'RWB', displayPosition: 'RWB', line: 'DEF', x: 86, y: 68, acceptedPositions: accepted('RWB') },
      { slotId: 'CM1', displayPosition: 'CM', line: 'MID', x: 36, y: 44, acceptedPositions: accepted('CM') },
      { slotId: 'CM2', displayPosition: 'CM', line: 'MID', x: 63, y: 56, acceptedPositions: accepted('CM') },
      { slotId: 'LF', displayPosition: 'LF', line: 'ATT', x: 22, y: 23, acceptedPositions: accepted('LF') },
      { slotId: 'ST', displayPosition: 'ST', line: 'ATT', x: 50, y: 11, acceptedPositions: accepted('ST') },
      { slotId: 'RF', displayPosition: 'RF', line: 'ATT', x: 78, y: 23, acceptedPositions: accepted('RF') },
    ],
  },
];

export const DEFAULT_FORMATION_ID = '4-3-3';

export function getFormation(formationId: string): FormationConfig {
  return FORMATIONS.find((formation) => formation.formationId === formationId) ?? FORMATIONS[0];
}
