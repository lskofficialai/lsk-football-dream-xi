import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Clock3,
  HelpCircle,
  Home,
  Lock,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { DEFAULT_FORMATION_ID, FORMATIONS, getFormation } from './config/formations';
import type { FormationConfig, GameMode, NormalizedPosition, PlayerCandidate, SlotSelection, SquadPools, SquadResult, SquadSlot } from './types';
import {
  buildSquadSlots,
  calculateSquadResult,
  eligibleClubsForFormation,
  ensurePlayableSlot,
  FALLBACK_SQUAD_POOLS,
  formatRecord,
  getPlayablePools,
  loadHistory,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  pickReplacementClubForFormation,
  POSITIONS,
  RANDOM_MIX_CLUB_IDS,
  replaceSlotCondition,
  resolveCandidatesForSlot,
  saveHistory,
} from './game';
import { captureElementToPng, downloadPng } from './poster';

type Screen = 'home' | 'mode' | 'formation' | 'singleClubConfig' | 'squad' | 'result';

const modeIcons: Record<GameMode, typeof Shuffle> = {
  random: Shuffle,
  singleClub: Users,
};

const INITIAL_CHANGE_COUNT = 3;
const ATT_POSITION_ORDER: Partial<Record<NormalizedPosition, number>> = { ST: 0, LF: 1, RF: 2 };
const MID_POSITION_ORDER: Partial<Record<NormalizedPosition, number>> = { CAM: 0, CM: 1, CDM: 2, LM: 3, RM: 4 };
const DEF_POSITION_ORDER: Partial<Record<NormalizedPosition, number>> = { LB: 0, LWB: 0, CB: 1, RB: 2, RWB: 2 };

function selectedBySlot(selections: SlotSelection[]) {
  return new Map(selections.map((selection) => [selection.slotId, selection.candidate]));
}

function selectedIds(selections: SlotSelection[], excludeSlotId?: string) {
  return new Set(
    selections
      .filter((selection) => selection.slotId !== excludeSlotId)
      .map((selection) => selection.candidate.playerId),
  );
}

function clubDisplay(clubName: string, clubCnName?: string) {
  return clubCnName ?? clubName;
}

function candidatePositions(candidate: PlayerCandidate) {
  return candidate.normalizedPositions?.length ? candidate.normalizedPositions : candidate.originalPositions;
}

const positionSet = new Set<NormalizedPosition>(POSITIONS);
const positionAliases: Record<string, NormalizedPosition> = {
  LW: 'LF',
  RW: 'RF',
  CF: 'ST',
  SW: 'CB',
  GOALKEEPER: 'GK',
  'CENTRE-BACK': 'CB',
  'CENTER-BACK': 'CB',
  'LEFT-BACK': 'LB',
  'RIGHT-BACK': 'RB',
  'DEFENSIVE MIDFIELDER': 'CDM',
  'CENTRAL MIDFIELDER': 'CM',
  'ATTACKING MIDFIELDER': 'CAM',
  'LEFT WINGER': 'LF',
  'RIGHT WINGER': 'RF',
  STRIKER: 'ST',
  'CENTRE-FORWARD': 'ST',
  'CENTER-FORWARD': 'ST',
  FORWARD: 'ST',
  前锋: 'ST',
  中锋: 'ST',
  左边锋: 'LF',
  右边锋: 'RF',
  前腰: 'CAM',
  中场: 'CM',
  后腰: 'CDM',
  中后卫: 'CB',
  左后卫: 'LB',
  右后卫: 'RB',
  门将: 'GK',
};

function normalizePositionValue(value: string): NormalizedPosition | null {
  const key = value.trim().toUpperCase().replace(/_/g, '-');
  if (positionSet.has(key as NormalizedPosition)) return key as NormalizedPosition;
  return positionAliases[key] ?? null;
}

function playablePositions(candidate: PlayerCandidate): NormalizedPosition[] {
  const values = [...(candidate.normalizedPositions ?? []), ...(candidate.originalPositions ?? []), candidate.position];
  const normalized = values.flatMap((value) => {
    const position = normalizePositionValue(String(value));
    return position ? [position] : [];
  });
  return [...new Set(normalized)];
}

function canCandidatePlaySlot(candidate: PlayerCandidate, slot: SquadSlot): boolean {
  return playablePositions(candidate).some((position) => position === slot.displayPosition || slot.acceptedPositions.includes(position));
}

function slotPickGroup(slot: SquadSlot): number {
  if (slot.displayPosition === 'GK') return 3;
  if (slot.displayPosition === 'LWB' || slot.displayPosition === 'RWB') return 2;
  if (slot.line === 'ATT') return 0;
  if (slot.line === 'MID') return 1;
  if (slot.line === 'DEF') return 2;
  return 3;
}

function slotPositionOrder(slot: SquadSlot): number {
  const group = slotPickGroup(slot);
  if (group === 0) return ATT_POSITION_ORDER[slot.displayPosition] ?? 20;
  if (group === 1) return MID_POSITION_ORDER[slot.displayPosition] ?? 20;
  if (group === 2) return DEF_POSITION_ORDER[slot.displayPosition] ?? 20;
  return 0;
}

function sortSlotsForPicking(slots: SquadSlot[]): number[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const groupDiff = slotPickGroup(a.slot) - slotPickGroup(b.slot);
      if (groupDiff !== 0) return groupDiff;

      const positionDiff = slotPositionOrder(a.slot) - slotPositionOrder(b.slot);
      if (positionDiff !== 0) return positionDiff;

      if (slotPickGroup(a.slot) === 2) return a.slot.x - b.slot.x || a.slot.y - b.slot.y;
      return a.slot.y - b.slot.y || a.slot.x - b.slot.x;
    })
    .map((item) => item.index);
}

function firstPickSlotIndex(slots: SquadSlot[]): number {
  return sortSlotsForPicking(slots)[0] ?? 0;
}

function MiniFormation({ formation }: { formation: FormationConfig }) {
  return (
    <div className="mini-formation" aria-hidden="true">
      {formation.slots.map((slot) => (
        <span key={slot.slotId} style={{ left: `${slot.x}%`, top: `${slot.y}%` }} />
      ))}
    </div>
  );
}

function CoreCards({ selections, slots }: { selections: SlotSelection[]; slots: SquadSlot[] }) {
  const slotMap = new Map(slots.map((slot) => [slot.slotId, slot]));
  const players = selections
    .map((selection) => ({ candidate: selection.candidate, slot: slotMap.get(selection.slotId) }))
    .sort((a, b) => (b.candidate.periodRating ?? b.candidate.rating) - (a.candidate.periodRating ?? a.candidate.rating))
    .slice(0, 8);

  return (
    <div className="core-cards">
      {players.map(({ candidate, slot }, index) => (
        <article className={`core-card core-card-${index}`} key={`${candidate.playerId}-${slot?.slotId ?? index}`}>
          <span className="card-topline">
            <b className="card-rating">{candidate.periodRating ?? candidate.rating}</b>
            <b className="card-position">{slot?.displayPosition ?? candidate.position}</b>
          </span>
          <strong>{candidate.displayName}</strong>
          <em>
            {clubDisplay(candidate.clubName, candidate.clubCnName)} · {candidate.era}
          </em>
          <small>
            {candidate.periodTag ?? '核心期'} · {candidate.periodRating ?? candidate.rating}
          </small>
        </article>
      ))}
    </div>
  );
}

function ResultLineup({ selections, slots }: { selections: SlotSelection[]; slots: SquadSlot[] }) {
  const selectionMap = selectedBySlot(selections);
  return (
    <section className="result-lineup" aria-label="十一人阵容">
      <strong>十一人阵容</strong>
      <div>
        {slots.map((slot) => {
          const selected = selectionMap.get(slot.slotId);
          return (
            <span key={slot.slotId}>
              <b>{slot.displayPosition}</b>
              <em>{selected?.displayName ?? '未选择'}</em>
            </span>
          );
        })}
      </div>
    </section>
  );
}

export default function App() {
  const [rawPools, setRawPools] = useState<SquadPools | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataNotice, setDataNotice] = useState('');
  const [screen, setScreen] = useState<Screen>('home');
  const [formationId, setFormationId] = useState(DEFAULT_FORMATION_ID);
  const [mode, setMode] = useState<GameMode>('random');
  const [singleClubId, setSingleClubId] = useState('real_madrid');
  const [slots, setSlots] = useState<SquadSlot[]>([]);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [selections, setSelections] = useState<SlotSelection[]>([]);
  const [lockedSlots, setLockedSlots] = useState<string[]>([]);
  const [clubChangesLeft, setClubChangesLeft] = useState(INITIAL_CHANGE_COUNT);
  const [eraChangesLeft, setEraChangesLeft] = useState(INITIAL_CHANGE_COUNT);
  const [result, setResult] = useState<SquadResult | null>(null);
  const [isSavingPoster, setIsSavingPoster] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [swapSlotId, setSwapSlotId] = useState<string | null>(null);
  const resultCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadPools() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/squadPools.json`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as SquadPools;
        if (!alive) return;
        setRawPools(payload);
        if (payload.stats.totalCandidates <= 0) setDataNotice('真实候选池为空，当前使用 fallback 示例数据。');
      } catch (error) {
        if (!alive) return;
        setRawPools(FALLBACK_SQUAD_POOLS);
        setDataNotice(`候选池加载失败，已启用 fallback 示例数据：${error instanceof Error ? error.message : 'unknown error'}`);
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    loadPools();
    return () => {
      alive = false;
    };
  }, []);

  const data = useMemo(() => getPlayablePools(rawPools), [rawPools]);
  const formation = useMemo(() => getFormation(formationId), [formationId]);
  const singleClubOptions = data.clubs;
  const selectedMap = useMemo(() => selectedBySlot(selections), [selections]);
  const pickOrderIndexes = useMemo(() => sortSlotsForPicking(slots), [slots]);
  const filledCount = selections.length;
  const canFinish = filledCount === 11;
  const currentSlot = slots[currentSlotIndex];
  const currentPickOrderIndex = pickOrderIndexes.findIndex((index) => index === currentSlotIndex);
  const currentRoundNumber = currentPickOrderIndex >= 0 ? currentPickOrderIndex + 1 : currentSlotIndex + 1;
  const currentSlotLocked = currentSlot ? lockedSlots.includes(currentSlot.slotId) : false;
  const history = useMemo(() => loadHistory(), [showHistory, result]);
  const fixedClubId = mode === 'singleClub' ? slots[0]?.clubId ?? singleClubId : undefined;
  const randomClubScope = mode === 'random' ? RANDOM_MIX_CLUB_IDS : undefined;
  const currentModeHeader =
    mode === 'singleClub' && currentSlot
      ? `${MODE_LABELS[mode]} · ${clubDisplay(currentSlot.clubName, currentSlot.clubCnName)} · ${formation.name}`
      : `${MODE_LABELS[mode]} · ${formation.name}`;

  const currentCandidates = currentSlot
    ? resolveCandidatesForSlot(data, currentSlot, selectedIds(selections, currentSlot.slotId), { fixedClubId, clubIds: randomClubScope })
    : null;

  useEffect(() => {
    if (!currentSlot || currentSlotLocked) return;
    const nextSlot = ensurePlayableSlot(
      data,
      currentSlot,
      selectedIds(selections, currentSlot.slotId),
      `${Date.now()}-${currentSlot.slotId}`,
      { fixedClubId, clubIds: randomClubScope },
    );
    if (nextSlot.clubId === currentSlot.clubId && nextSlot.era === currentSlot.era) return;

    setSlots((current) => current.map((slot) => (slot.slotId === currentSlot.slotId ? nextSlot : slot)));
    setDataNotice('该条件候选较少，已自动切换到可玩历史池。');
  }, [currentSlot?.slotId, currentSlot?.clubId, currentSlot?.era, currentSlotLocked, data, selections, fixedClubId, randomClubScope]);

  useEffect(() => {
    if (singleClubOptions.length > 0 && !singleClubOptions.some((club) => club.clubId === singleClubId)) {
      setSingleClubId(singleClubOptions[0].clubId);
    }
  }, [singleClubId, singleClubOptions]);

  function selectMode(modeToSelect: GameMode) {
    setMode(modeToSelect);
    setDataNotice('');
    setScreen(modeToSelect === 'singleClub' ? 'singleClubConfig' : 'formation');
  }

  function startWithFormation(formationToStart: FormationConfig) {
    const clubId =
      mode === 'singleClub'
        ? singleClubOptions.find((club) => club.clubId === singleClubId)?.clubId ?? singleClubOptions[0]?.clubId ?? singleClubId
        : singleClubId;

    if (mode === 'singleClub' && !eligibleClubsForFormation(data, formationToStart).some((club) => club.clubId === clubId)) {
      setDataNotice('该队套当前数据暂不适合该阵型。');
      return;
    }

    const nextSlots = buildSquadSlots(data, mode, formationToStart, {
      clubId,
      seed: `${Date.now()}-${mode}-${formationToStart.formationId}`,
    });
    if (mode === 'singleClub') setSingleClubId(clubId);
    setDataNotice('');
    setFormationId(formationToStart.formationId);
    setSlots(nextSlots);
    setCurrentSlotIndex(firstPickSlotIndex(nextSlots));
    setSelections([]);
    setLockedSlots([]);
    setClubChangesLeft(INITIAL_CHANGE_COUNT);
    setEraChangesLeft(INITIAL_CHANGE_COUNT);
    setResult(null);
    setIsSavingPoster(false);
    setShowHistory(false);
    setSwapSlotId(null);
    setScreen('squad');
  }

  function nextUnselectedSlotIndex(nextSelections: SlotSelection[], fromIndex: number): number {
    const nextSelectedMap = selectedBySlot(nextSelections);
    const order = pickOrderIndexes.length > 0 ? pickOrderIndexes : slots.map((_, index) => index);
    const currentOrderIndex = order.findIndex((index) => index === fromIndex);
    const afterCurrent = currentOrderIndex >= 0 ? order.slice(currentOrderIndex + 1) : order;
    const nextAfter = afterCurrent.find((index) => !nextSelectedMap.has(slots[index]?.slotId));
    if (nextAfter !== undefined) return nextAfter;

    const nextAny = order.find((index) => !nextSelectedMap.has(slots[index]?.slotId));
    return nextAny ?? -1;
  }

  function choosePlayer(slot: SquadSlot, candidate: PlayerCandidate) {
    const nextSelections = [
      ...selections.filter((selection) => selection.slotId !== slot.slotId),
      { slotId: slot.slotId, candidate },
    ];
    setSelections(nextSelections);
    setSwapSlotId(null);
    const currentIndex = slots.findIndex((nextSlot) => nextSlot.slotId === slot.slotId);
    const nextIndex = nextUnselectedSlotIndex(nextSelections, currentIndex);
    if (nextIndex >= 0) setCurrentSlotIndex(nextIndex);
  }

  function swapPlayers(firstSlotId: string, secondSlotId: string) {
    const firstSlot = slots.find((slot) => slot.slotId === firstSlotId);
    const secondSlot = slots.find((slot) => slot.slotId === secondSlotId);
    const firstPlayer = selectedMap.get(firstSlotId);
    const secondPlayer = selectedMap.get(secondSlotId);
    if (!firstSlot || !secondSlot || !firstPlayer || !secondPlayer) return;

    const canSwap = canCandidatePlaySlot(firstPlayer, secondSlot) && canCandidatePlaySlot(secondPlayer, firstSlot);
    if (!canSwap) {
      setSwapSlotId(null);
      setDataNotice('位置不匹配，无法互换');
      return;
    }

    setSelections((current) =>
      current.map((selection) => {
        if (selection.slotId === firstSlotId) return { ...selection, candidate: secondPlayer };
        if (selection.slotId === secondSlotId) return { ...selection, candidate: firstPlayer };
        return selection;
      }),
    );
    setSwapSlotId(null);
    setCurrentSlotIndex(slots.findIndex((slot) => slot.slotId === secondSlotId));
    setDataNotice('换位成功');
  }

  function handleSlotClick(slot: SquadSlot, index: number) {
    const selected = selectedMap.get(slot.slotId);
    setCurrentSlotIndex(index);

    if (!selected) {
      setSwapSlotId(null);
      return;
    }

    if (!swapSlotId) {
      setSwapSlotId(slot.slotId);
      setDataNotice('已选择换位球员，请点击另一个球员进行互换。');
      return;
    }

    if (swapSlotId === slot.slotId) {
      setSwapSlotId(null);
      setDataNotice('已取消换位选择。');
      return;
    }

    swapPlayers(swapSlotId, slot.slotId);
  }

  function changeCurrentCondition(kind: 'club' | 'era') {
    if (!currentSlot || currentSlotLocked) return;
    if (kind === 'club' && clubChangesLeft <= 0) return;
    if (kind === 'era' && eraChangesLeft <= 0) return;

    if (mode === 'singleClub' && kind === 'club') {
      const nextClub = pickReplacementClubForFormation(
        data,
        formation,
        slots[0]?.clubId ?? currentSlot.clubId,
        `${Date.now()}-single-club`,
      );
      if (!nextClub) {
        setDataNotice('该队套当前数据暂不适合该阵型');
        return;
      }

      const nextSlots = buildSquadSlots(data, 'singleClub', formation, {
        clubId: nextClub.clubId,
        seed: `${Date.now()}-single-club-${nextClub.clubId}`,
      });
      setSingleClubId(nextClub.clubId);
      setSlots(nextSlots);
      setCurrentSlotIndex(firstPickSlotIndex(nextSlots));
      setSelections([]);
      setLockedSlots([]);
      setSwapSlotId(null);
      setClubChangesLeft((value) => Math.max(0, value - 1));
      setDataNotice(`已切换为${clubDisplay(nextClub.clubName, nextClub.clubCnName)}队套，阵容已重置。`);
      return;
    }

    const nextSlot = replaceSlotCondition(data, currentSlot, kind, selectedIds(selections, currentSlot.slotId), `${Date.now()}-${kind}`, {
      clubIds: randomClubScope,
    });
    if (nextSlot.clubId === currentSlot.clubId && nextSlot.era === currentSlot.era) {
      setDataNotice('当前条件可替换项不足');
      return;
    }
    setSlots((current) => current.map((slot) => (slot.slotId === currentSlot.slotId ? nextSlot : slot)));
    setSwapSlotId(null);
    if (kind === 'club') setClubChangesLeft((value) => Math.max(0, value - 1));
    if (kind === 'era') setEraChangesLeft((value) => Math.max(0, value - 1));
  }

  function lockCurrentSlot() {
    if (!currentSlot || currentSlotLocked) return;
    setLockedSlots((current) => [...current, currentSlot.slotId]);
  }

  function finishSquad() {
    const nextResult = calculateSquadResult(formation, slots, selections);
    setResult(nextResult);
    saveHistory(mode, nextResult);
    setScreen('result');
  }

  async function buildPoster() {
    if (!resultCardRef.current) return;
    try {
      setIsSavingPoster(true);
      const dataUrl = await captureElementToPng(resultCardRef.current);
      downloadPng(dataUrl, 'lsk-football-dream-xi.png');
    } catch (error) {
      setDataNotice(`战报图生成失败：${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSavingPoster(false);
    }
  }

function resetToHome() {
    setScreen('home');
    setSlots([]);
    setSelections([]);
    setCurrentSlotIndex(0);
    setLockedSlots([]);
    setResult(null);
    setIsSavingPoster(false);
    setShowHistory(false);
    setSwapSlotId(null);
  }

  function resetToModeSelect() {
    setScreen('mode');
    setSlots([]);
    setSelections([]);
    setCurrentSlotIndex(0);
    setLockedSlots([]);
    setClubChangesLeft(INITIAL_CHANGE_COUNT);
    setEraChangesLeft(INITIAL_CHANGE_COUNT);
    setResult(null);
    setIsSavingPoster(false);
    setShowHistory(false);
    setSwapSlotId(null);
    setDataNotice('');
  }

  if (isLoading) {
    return (
      <main className="app-shell star-shell">
        <div className="loading">候选池加载中...</div>
      </main>
    );
  }

  return (
    <main className={screen === 'result' ? 'app-shell star-shell' : 'app-shell pitch-shell'}>
      {screen === 'home' && (
        <section className="screen home-screen">
          <div className="logo-badge" aria-label="LSK">
            <img alt="LSK logo" src={`${import.meta.env.BASE_URL}lsk-logo.png`} />
          </div>
          <div className="home-copy">
            <p className="eyebrow">Football Dream XI</p>
            <h1>足球混搭梦幻十一人</h1>
            <p className="subtitle">球队 × 年代 × 位置，组出你的历史级强队</p>
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={() => {
              setShowRules(false);
              setScreen('mode');
            }}
          >
            <Play size={20} />
            开始组队
          </button>
          <button className="rules-button" type="button" onClick={() => setShowRules(true)}>
            <HelpCircle size={18} />
            规则说明
          </button>
          <p className="data-note">
            <Clock3 size={15} />
            <span>
              {data.stats.totalPlayers} 名球员 · {data.stats.totalCandidates} 个候选
            </span>
          </p>
          {dataNotice && <p className="notice-line">{dataNotice}</p>}
        </section>
      )}

      {screen === 'mode' && (
        <section className="screen mode-screen">
          <div className="screen-header">
            <p className="eyebrow">Choose Mode</p>
            <h2>选择组队方式</h2>
          </div>
          {dataNotice && <p className="notice-line">{dataNotice}</p>}

          <div className="mode-list">
            {(['random', 'singleClub'] as GameMode[]).map((item) => {
              const Icon = modeIcons[item];
              return (
                <button className={`mode-card mode-card-${item}`} key={item} type="button" onClick={() => selectMode(item)}>
                  <span className="mode-icon">
                    <Icon size={22} />
                  </span>
                  <span className="mode-copy">
                    <strong>{MODE_LABELS[item]}</strong>
                    <span>{MODE_DESCRIPTIONS[item]}</span>
                  </span>
                  <ChevronRight size={20} />
                </button>
              );
            })}
          </div>

          <button className="ghost-action" type="button" onClick={resetToHome}>
            返回首页
          </button>
        </section>
      )}

      {screen === 'formation' && (
        <section className="screen formation-screen">
          <div className="screen-header">
            <p className="eyebrow">{MODE_LABELS[mode]}</p>
            <h2>选择阵型</h2>
            <p className="section-subtitle">不同阵型会影响每轮位置和最终评分</p>
          </div>
          {dataNotice && <p className="notice-line">{dataNotice}</p>}

          <div className="formation-list">
            {FORMATIONS.map((item) => (
              <button
                className={item.formationId === formationId ? 'formation-card is-active' : 'formation-card'}
                key={item.formationId}
                type="button"
                onClick={() => startWithFormation(item)}
              >
                <MiniFormation formation={item} />
                <span>
                  <strong>{item.name}</strong>
                  <em>{item.description}</em>
                </span>
                <ChevronRight size={20} />
              </button>
            ))}
          </div>

          <button className="ghost-action" type="button" onClick={() => setScreen('mode')}>
            返回组队方式
          </button>
        </section>
      )}

      {screen === 'singleClubConfig' && (
        <section className="screen mode-screen">
          <div className="screen-header">
            <p className="eyebrow">Single Club</p>
            <h2>单一队套挑战</h2>
            <p className="section-subtitle">选择一个俱乐部和阵型，每个位置随机该俱乐部的不同时代。</p>
          </div>
          {dataNotice && <p className="notice-line">{dataNotice}</p>}

          <section className="single-club-panel">
            <label>
              球队
              <select value={singleClubId} onChange={(event) => setSingleClubId(event.target.value)}>
                {singleClubOptions.map((club) => (
                  <option key={club.clubId} value={club.clubId}>
                    {clubDisplay(club.clubName, club.clubCnName)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <div className="formation-list">
            {FORMATIONS.map((item) => (
              <button
                className={item.formationId === formationId ? 'formation-card is-active' : 'formation-card'}
                key={item.formationId}
                type="button"
                onClick={() => startWithFormation(item)}
              >
                <MiniFormation formation={item} />
                <span>
                  <strong>{item.name}</strong>
                  <em>{item.description}</em>
                </span>
                <ChevronRight size={20} />
              </button>
            ))}
          </div>

          <button className="ghost-action" type="button" onClick={() => setScreen('mode')}>
            返回组队方式
          </button>
        </section>
      )}

      {screen === 'squad' && (
        <section className="screen squad-screen">
          <header className="squad-header">
            <div>
              <p className="eyebrow">
                {currentModeHeader}
              </p>
              <h2>完成你的 11 人阵容</h2>
            </div>
            <span>{filledCount}/11</span>
          </header>
          {dataNotice && <p className="notice-line">{dataNotice}</p>}

          <div className="formation-board">
            <div className="field-line center-circle" />
            {slots.map((slot, index) => {
              const selected = selectedMap.get(slot.slotId);
              const isCurrent = currentSlot?.slotId === slot.slotId;
              const isSwapSelected = swapSlotId === slot.slotId;
              const slotClubName = selected ? clubDisplay(selected.clubName, selected.clubCnName) : clubDisplay(slot.clubName, slot.clubCnName);
              const slotEra = selected?.era ?? slot.era;
              return (
                <button
                  className={`${selected ? 'slot-card is-picked' : 'slot-card'} ${isCurrent ? 'is-current' : ''} ${isSwapSelected ? 'is-swap-selected' : ''}`}
                  key={slot.slotId}
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  type="button"
                  onClick={() => handleSlotClick(slot, index)}
                >
                  <strong className="slot-position">{slot.displayPosition}</strong>
                  <span className="slot-club">{slotClubName}</span>
                  <span className="slot-era">{slotEra}</span>
                  <em className="slot-action">{selected?.displayName ?? '点击选人'}</em>
                </button>
              );
            })}
          </div>

          {currentSlot && (
            <section className="round-panel">
              <div className="round-heading">
                <p className="eyebrow">
                  第 {currentRoundNumber} / 11 轮
                </p>
                <h2>位置：{currentSlot.displayPosition}</h2>
                <span>
                  球队：{clubDisplay(currentSlot.clubName, currentSlot.clubCnName)} · 年代：{currentSlot.era}
                </span>
              </div>
              <div className="round-actions">
                <button className="ghost-action" disabled={currentSlotLocked} type="button" onClick={lockCurrentSlot}>
                  <Lock size={18} />
                  {currentSlotLocked ? '已锁定' : '锁定'}
                </button>
                <button className="ghost-action" disabled={currentSlotLocked || clubChangesLeft <= 0} type="button" onClick={() => changeCurrentCondition('club')}>
                  更换球队 {clubChangesLeft}次
                </button>
                <button className="ghost-action" disabled={currentSlotLocked || eraChangesLeft <= 0} type="button" onClick={() => changeCurrentCondition('era')}>
                  更换年代 {eraChangesLeft}次
                </button>
              </div>
              {currentCandidates && <p className={`candidate-note source-${currentCandidates.source}`}>{currentCandidates.note}</p>}
            </section>
          )}

          <div className="candidate-list inline-candidates">
            {currentCandidates?.candidates.slice(0, 18).map((candidate) => (
              <button
                className="candidate-row"
                key={`${candidate.playerId}-${candidate.clubId}-${candidate.era}-${candidate.position}`}
                type="button"
                onClick={() => currentSlot && choosePlayer(currentSlot, candidate)}
              >
                <span className="candidate-rating">{candidate.periodRating ?? candidate.rating}</span>
                <span className="candidate-copy">
                  <strong>{candidate.displayName}</strong>
                  <span className="position-tags">
                    {candidatePositions(candidate).map((position) => (
                      <b key={`${candidate.playerId}-${position}`}>{position}</b>
                    ))}
                  </span>
                  <em>
                    {clubDisplay(candidate.clubName, candidate.clubCnName)} · {candidate.era}
                  </em>
                  <small>
                    {candidate.periodTag ?? '核心期'} · {candidate.periodRating ?? candidate.rating}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>

          <div className="squad-actions">
            <button className="ghost-action" type="button" onClick={() => setScreen(mode === 'singleClub' ? 'singleClubConfig' : 'formation')}>
              {mode === 'singleClub' ? '返回队套配置' : '返回阵型选择'}
            </button>
            <button className="ghost-action home-return-action" type="button" onClick={resetToModeSelect}>
              <Home size={20} />
              返回首页
            </button>
            <button className="primary-action" disabled={!canFinish} type="button" onClick={finishSquad}>
              <Trophy size={20} />
              查看预测战绩
            </button>
          </div>
        </section>
      )}

      {screen === 'result' && result && (
        <section className="screen result-screen">
          <article className="result-card" ref={resultCardRef}>
            <div className="result-brand">
              <span>LSK</span>
              <strong>足球混搭梦幻十一人</strong>
            </div>
            <div className="result-main">
              <p className="result-label">阵型：{result.formationName}</p>
              <p className="result-label">预测战绩</p>
              <h2>{formatRecord(result.record)}</h2>
              <strong>
                {result.grade} {result.gradeText}
              </strong>
            </div>

            <CoreCards selections={selections} slots={slots} />

            <div className="score-grid">
              <span>
                进攻 <strong>{result.scores.attackScore}</strong>
              </span>
              <span>
                中场 <strong>{result.scores.midfieldScore}</strong>
              </span>
              <span>
                防守 <strong>{result.scores.defenseScore}</strong>
              </span>
              <span>
                默契 <strong>{result.scores.chemistryScore}</strong>
              </span>
            </div>

            <ResultLineup selections={selections} slots={slots} />

            <div className="result-footer">
              <span>LSK FOOTBALL DREAM XI</span>
            </div>
          </article>

          <div className="result-actions">
            <button className="primary-action" disabled={isSavingPoster} type="button" onClick={buildPoster}>
              <Camera size={20} />
              {isSavingPoster ? '生成中...' : '保存战报图'}
            </button>
            <button className="secondary-action" type="button" onClick={() => startWithFormation(formation)}>
              <RotateCcw size={20} />
              再来一局
            </button>
            <button className="ghost-action" type="button" onClick={() => setShowHistory((value) => !value)}>
              <Users size={20} />
              查看其他 LSK 玩家的成绩
            </button>
            <button className="ghost-action home-return-action" type="button" onClick={resetToModeSelect}>
              <Home size={20} />
              返回首页
            </button>
          </div>

          {showHistory && (
            <div className="history-panel">
              {history.length === 0 ? (
                <p>排行榜功能开发中，先截图发群里晒一下吧。</p>
              ) : (
                history.map((entry) => (
                  <article key={entry.id}>
                    <strong>{formatRecord(entry.record)}</strong>
                    <span>
                      {entry.formationName ?? '阵型'} · {entry.grade} {entry.gradeText} · 总评 {entry.overallScore}
                    </span>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      )}

      {showRules && (
        <div className="rules-backdrop" role="presentation" onClick={() => setShowRules(false)}>
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Game Guide</p>
            <h2 id="rules-title">玩法规则</h2>
            <ol>
              <li>
                先选择组队方式：随机混搭挑战每个位置随机不同球队与年代；单一队套挑战选择一个俱乐部，每个位置随机该队不同年代。
              </li>
              <li>选择阵型后开始组队。</li>
              <li>每个位置会给出候选球员，点击球员即可加入阵容。</li>
              <li>每局可以更换球队 3 次，更换年代 3 次。</li>
              <li>已选择的球员如果能胜任对方位置，可以点击两个球员进行换位。</li>
              <li>选满 11 人后生成预测战绩和阵容评级。</li>
              <li>保存战报图后可以分享给朋友挑战。</li>
            </ol>
            <button className="primary-action" type="button" onClick={() => setShowRules(false)}>
              知道了
            </button>
          </section>
        </div>
      )}

      {screen !== 'home' && (
        <div className="watermark">
          <Sparkles size={14} />
          LSK Dream XI
        </div>
      )}
    </main>
  );
}
