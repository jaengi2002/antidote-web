import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { CardBack, FormulaChip, GameCard } from './components/GameCard';
import { RulesPanel } from './components/RulesPanel';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;
const SESSION_KEY = 'antidote_session';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(data) {
  if (!data) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function createSocket() {
  return io(SOCKET_URL || '/', {
    autoConnect: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
  });
}

let socket = null;
function getSocket() {
  if (!socket) socket = createSocket();
  return socket;
}

const SAMPLE_FORMULAS = [
  { id: 'A', name: '적철독', nameEn: 'Ferric', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', name: '청람독', nameEn: 'Azure', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', name: '녹청독', nameEn: 'Viridian', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', name: '호박독', nameEn: 'Amber', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', name: '자정독', nameEn: 'Violet', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', name: '주황독', nameEn: 'Rust', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', name: '청록독', nameEn: 'Teal', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
];

const SAMPLE_CARDS = [
  { id: 's1', type: 'number', formulaId: 'A', value: 3, label: '적철독 3', symbol: 'skull', name: '적철독', nameEn: 'Ferric' },
  { id: 's2', type: 'x', formulaId: 'B', label: '청람독 X', symbol: 'drop', name: '청람독', nameEn: 'Azure' },
  { id: 's3', type: 'syringe', label: '주사기', symbol: 'syringe' },
];

export default function App() {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem('antidote_name') || '');
  const [joinCode, setJoinCode] = useState('');
  const [state, setState] = useState(null);
  const [session, setSession] = useState(() => loadSession());
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [action, setAction] = useState('discard');
  const [tradeTarget, setTradeTarget] = useState('');
  const [syringeMode, setSyringeMode] = useState('hand');
  const [stealTarget, setStealTarget] = useState('');
  const [wsPick, setWsPick] = useState(null);
  const [tradeResponseCard, setTradeResponseCard] = useState(null);
  const [showRules, setShowRules] = useState(false);

  const formulas = state?.formulas?.length ? state.formulas : SAMPLE_FORMULAS;

  const persistSession = useCallback(
    (payload) => {
      if (!payload?.sessionToken) return;
      const next = {
        sessionToken: payload.sessionToken,
        playerId: payload.playerId,
        roomCode: payload.roomCode || payload.state?.code,
        name: name.trim(),
      };
      saveSession(next);
      setSession(next);
    },
    [name]
  );

  const clearSessionLocal = useCallback(() => {
    saveSession(null);
    setSession(null);
    setState(null);
  }, []);

  const applyAck = useCallback(
    (res) => {
      if (!res?.ok) {
        setError(res?.error || '요청 실패');
        return false;
      }
      if (res.sessionToken) persistSession(res);
      if (res.state) setState(res.state);
      setError('');
      return true;
    },
    [persistSession]
  );

  const tryReconnect = useCallback(() => {
    const s = loadSession();
    if (!s?.sessionToken) return;
    setReconnecting(true);
    setInfo('재접속 중…');
    getSocket().emit('reconnectSession', { sessionToken: s.sessionToken }, (res) => {
      setReconnecting(false);
      if (!res?.ok) {
        setInfo('');
        setError(res?.error || '재접속 실패');
        saveSession(null);
        setSession(null);
        return;
      }
      setInfo('테이블로 돌아왔습니다.');
      applyAck(res);
      setTimeout(() => setInfo(''), 2000);
    });
  }, [applyAck]);

  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      setConnected(true);
      if (loadSession()?.sessionToken) tryReconnect();
    };
    const onDisconnect = () => {
      setConnected(false);
      setInfo('연결 끊김 — 재연결 시도 중…');
    };
    const onState = (view) => {
      setState(view);
      setError('');
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('gameState', onState);
    if (s.connected) {
      setConnected(true);
      if (loadSession()?.sessionToken) tryReconnect();
    }
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('gameState', onState);
    };
  }, [tryReconnect]);

  useEffect(() => {
    setSelectedCardId(null);
    setWsPick(null);
    setTradeResponseCard(null);
  }, [state?.turnPlayerId, state?.status, state?.pending?.type]);

  const saveName = (n) => {
    setName(n);
    localStorage.setItem('antidote_name', n);
  };

  const createRoom = () => {
    if (!name.trim()) return setError('닉네임을 입력하세요.');
    getSocket().emit('createRoom', { name: name.trim() }, (res) => applyAck(res));
  };

  const joinRoom = () => {
    if (!name.trim()) return setError('닉네임을 입력하세요.');
    if (!joinCode.trim()) return setError('방 코드를 입력하세요.');
    getSocket().emit('joinRoom', { code: joinCode.trim(), name: name.trim() }, (res) =>
      applyAck(res)
    );
  };

  const leaveRoom = () => {
    getSocket().emit('leaveRoom', () => {
      clearSessionLocal();
      setInfo('방에서 나갔습니다.');
    });
  };

  const startGame = () => getSocket().emit('startGame', (res) => applyAck(res));

  const others = useMemo(
    () => (state?.players || []).filter((p) => !p.isMe && !p.isSilent),
    [state]
  );
  const syringeTargets = useMemo(
    () => (state?.players || []).filter((p) => !p.isMe),
    [state]
  );
  const me = useMemo(() => (state?.players || []).find((p) => p.isMe), [state]);

  const selectForPending = (cardId) => {
    getSocket().emit('selectPendingCard', { cardId }, (res) => applyAck(res));
  };

  const beginDiscard = () => getSocket().emit('beginMassDiscard', (res) => applyAck(res));
  const beginPass = (direction) =>
    getSocket().emit('beginMassPass', { direction }, (res) => applyAck(res));

  const doTrade = () => {
    if (!selectedCardId) return setError('줄 카드를 고르세요.');
    if (!tradeTarget) return setError('상대를 고르세요.');
    getSocket().emit(
      'proposeTrade',
      { toId: tradeTarget, offerCardId: selectedCardId },
      (res) => applyAck(res)
    );
  };

  const doSyringe = () => {
    if (!stealTarget) return setError('대상을 고르세요.');
    if (syringeMode === 'hand') {
      getSocket().emit(
        'useSyringe',
        { mode: 'hand', targetPlayerId: stealTarget },
        (res) => applyAck(res)
      );
    } else {
      getSocket().emit(
        'useSyringe',
        {
          mode: 'workstation',
          targetPlayerId: stealTarget,
          workstationIndex: wsPick ?? undefined,
        },
        (res) => applyAck(res)
      );
    }
  };

  const acceptTrade = () => {
    if (!tradeResponseCard) return setError('내줄 카드를 고르세요.');
    getSocket().emit(
      'respondTrade',
      { accept: true, responseCardId: tradeResponseCard },
      (res) => {
        if (applyAck(res)) setTradeResponseCard(null);
      }
    );
  };

  const rejectTrade = () =>
    getSocket().emit('respondTrade', { accept: false }, (res) => applyAck(res));
  const cancelTrade = () => getSocket().emit('cancelTrade', (res) => applyAck(res));

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    setInfo('방 코드 복사됨');
    setTimeout(() => setInfo(''), 1500);
  };

  const hasSyringe = (state?.myHand || []).some((c) => c.type === 'syringe');
  const targetWs =
    syringeTargets.find((p) => p.id === stealTarget)?.workstation || [];

  // ═══════════ LANDING ═══════════
  if (!state) {
    return (
      <div className="app app--landing">
        <div className="wrap">
          <header className="landing-hero">
            <p className="landing-hero__badge">Official ruleset · 2–6 players</p>
            <h1>
              해독제 <em>Antidote</em>
            </h1>
            <p className="landing-hero__lead">
              번역 룰북 기준: 표1 세팅, 전원 동시 버리기, 워크스테이션, 패스/1:1, 주사기, 타임
              아웃 점수. 2인은 투명 플레이어 포함.
            </p>
            <div className={`conn-pill ${connected ? 'is-on' : ''}`}>
              <span className="conn-pill__dot" />
              {connected ? '서버 연결됨' : '서버 연결 중…'}
              {reconnecting ? ' · 재접속' : ''}
            </div>
          </header>

          <div className="sample-hand" aria-hidden>
            {SAMPLE_CARDS.map((c) => (
              <GameCard key={c.id} card={c} formulas={SAMPLE_FORMULAS} size="md" />
            ))}
          </div>

          <div className="landing-grid">
            <div>
              {session?.sessionToken && (
                <div className="panel panel--dark" style={{ marginBottom: '1rem' }}>
                  <h2>이어하기</h2>
                  <p style={{ margin: '0 0 0.75rem', opacity: 0.75, fontSize: '0.9rem' }}>
                    방 <strong style={{ letterSpacing: '0.15em' }}>{session.roomCode || '?'}</strong>
                  </p>
                  <div className="btn-row">
                    <button type="button" className="btn btn--gold" onClick={tryReconnect} disabled={!connected}>
                      테이블로
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={clearSessionLocal}>
                      세션 삭제
                    </button>
                  </div>
                </div>
              )}
              <div className="panel">
                <h2>테이블 잡기</h2>
                <label>
                  닉네임
                  <input value={name} maxLength={16} onChange={(e) => saveName(e.target.value)} />
                </label>
                <button type="button" className="btn btn--primary" onClick={createRoom} disabled={!connected}>
                  새 방 만들기
                </button>
                <div className="divider">또는 코드 입장</div>
                <label>
                  방 코드
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                  />
                </label>
                <button type="button" className="btn" style={{ width: '100%' }} onClick={joinRoom} disabled={!connected}>
                  입장
                </button>
                {error && <p className="msg-error">{error}</p>}
                {info && <p className="msg-info">{info}</p>}
              </div>
            </div>
            <div className="panel">
              <RulesPanel />
            </div>
          </div>
          <p className="fine">학습용 · Bellwether Games Antidote 룰 준수 · 아트 자체 제작</p>
        </div>
      </div>
    );
  }

  // ═══════════ LOBBY ═══════════
  if (state.status === 'lobby') {
    const iAmHost = state.hostId === state.me;
    return (
      <div className="app lobby-shell">
        <div className="wrap">
          <div className="table-topbar" style={{ borderRadius: 12, marginBottom: '1rem' }}>
            <h1>대기실</h1>
            <div className="table-topbar__meta">
              <span className="room-code">{state.code}</span>
              <button type="button" className="btn btn--ghost" onClick={() => copyCode(state.code)}>
                복사
              </button>
              <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
                나가기
              </button>
            </div>
          </div>
          <div className="landing-grid">
            <div className="panel panel--dark">
              <h2>좌석 ({state.players.length}/7)</h2>
              <div className="player-seats">
                {state.players.map((p) => (
                  <div key={p.id} className={`seat ${p.isHost ? 'is-host' : ''}`}>
                    <div className="seat__avatar">{(p.name || '?')[0]}</div>
                    <div className="seat__meta">
                      <strong>
                        {p.name}
                        {p.isMe ? ' (나)' : ''}
                      </strong>
                      <span>
                        {p.isHost ? '호스트 · ' : ''}
                        {p.connected ? '접속' : '오프라인'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {iAmHost ? (
                <button
                  type="button"
                  className="btn btn--gold"
                  onClick={startGame}
                  disabled={state.players.filter((p) => p.connected).length < 2}
                >
                  본작 규칙으로 시작
                </button>
              ) : (
                <p style={{ opacity: 0.65 }}>호스트 시작 대기…</p>
              )}
              {error && <p className="msg-error">{error}</p>}
            </div>
            <div className="panel">
              <RulesPanel compact />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ ENDED ═══════════
  if (state.status === 'ended') {
    const iWon = (state.winners || []).includes(state.me);
    const trueF = formulas.find((f) => f.id === state.antidoteFormulaId);
    return (
      <div className="app end-screen">
        <div className="wrap">
          <header className="end-screen__hero">
            <h1 className={iWon ? 'is-win' : ''}>{iWon ? '생존' : '실험 종료'}</h1>
            <p style={{ opacity: 0.75 }}>봉인되어 있던 해독제</p>
            <div className="end-reveal">
              {trueF && (
                <GameCard
                  size="xl"
                  formulas={formulas}
                  card={{
                    id: 'reveal',
                    type: 'x',
                    formulaId: trueF.id,
                    symbol: trueF.symbol,
                    name: trueF.name,
                    nameEn: trueF.nameEn,
                    label: trueF.name,
                  }}
                />
              )}
            </div>
            <p>
              생존:{' '}
              <strong>{state.winnerNames?.length ? state.winnerNames.join(', ') : '없음'}</strong>
            </p>
          </header>
          <div className="panel hands-reveal">
            <h2 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>결과 · 점수</h2>
            {state.players.map((p) => {
              const sc = state.scores?.[p.id];
              return (
                <div
                  key={p.id}
                  className={`hands-reveal__block ${(state.winners || []).includes(p.id) ? 'is-winner' : ''}`}
                >
                  <h3>
                    {p.name}
                    {p.isMe ? ' (나)' : ''} · {sc?.score ?? '?'}점
                  </h3>
                  <div className="hand-fan" style={{ minHeight: 0, justifyContent: 'flex-start' }}>
                    {sc?.lastCard && (
                      <GameCard card={sc.lastCard} formulas={formulas} size="md" />
                    )}
                    {(state.allWorkstations?.[p.id] || []).map((slot, i) => (
                      <GameCard
                        key={`ws-${i}`}
                        card={slot.card}
                        formulas={formulas}
                        size="sm"
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn btn--primary" onClick={leaveRoom}>
              로비로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ PLAYING ═══════════
  const turnName = state.players.find((p) => p.id === state.turnPlayerId)?.name || '?';
  const pending = state.pending;

  return (
    <div className="app app--table">
      <header className="table-topbar">
        <div>
          <h1>해독제 · 본작 규칙</h1>
          {state.config && (
            <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 8 }}>
              포뮬러 {state.config.formulas} · 숫자 1–{state.config.maxNumber} · 주사기{' '}
              {state.config.syringes}
              {state.silentMode ? ' · 투명P' : ''}
            </span>
          )}
        </div>
        <div className="table-topbar__meta">
          <span className="room-code">{state.code}</span>
          <div className={`turn-badge ${state.isMyTurn ? 'is-mine' : ''}`}>
            {pending
              ? pending.type === 'massDiscard'
                ? '전원 버리기 중'
                : pending.type === 'massPass'
                  ? '전원 패스 중'
                  : '거래 중'
              : state.isMyTurn
                ? '당신 차례'
                : `${turnName} 차례`}
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
            규칙
          </button>
          <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
            나가기
          </button>
        </div>
      </header>

      {!connected && <div className="banner banner--warn">오프라인 — 재연결 중…</div>}
      {error && (
        <div className="banner banner--error" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {error}
        </div>
      )}
      {info && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {info}
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop" onClick={() => setShowRules(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <RulesPanel />
            <button type="button" className="btn btn--primary" style={{ marginTop: 12 }} onClick={() => setShowRules(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Mass select modal */}
      {pending && (pending.type === 'massDiscard' || pending.type === 'massPass') && pending.needSelect && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{pending.type === 'massDiscard' ? '버리기 카드 선택' : '패스할 카드 선택'}</h2>
            <p>
              {pending.type === 'massDiscard'
                ? '전원 동시에 워크스테이션으로 버립니다. X는 뒷면, 나머지는 앞면.'
                : `전원 ${pending.direction === 'left' ? '왼쪽' : '오른쪽'}으로 1장 패스합니다. 건넨 뒤에야 받은 카드를 봅니다.`}
            </p>
            <div className="hand-fan">
              {(state.myHand || []).map((c) => (
                <GameCard
                  key={c.id}
                  card={c}
                  formulas={formulas}
                  size="md"
                  selected={selectedCardId === c.id}
                  onClick={() => setSelectedCardId(c.id)}
                />
              ))}
            </div>
            <button
              type="button"
              className="btn btn--primary"
              style={{ marginTop: 12 }}
              onClick={() => {
                if (!selectedCardId) return setError('카드를 고르세요.');
                selectForPending(selectedCardId);
              }}
            >
              확정
            </button>
          </div>
        </div>
      )}

      {pending && (pending.type === 'massDiscard' || pending.type === 'massPass') && !pending.needSelect && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {pending.iHaveSelected
            ? `선택 완료. 대기: ${(pending.waitingNames || []).join(', ') || '…'}`
            : '다른 플레이어 선택 대기…'}
        </div>
      )}

      {pending?.type === 'trade' && pending.amTarget && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>1:1 거래 제안</h2>
            <p>
              <strong>{pending.fromName}</strong> 님의 제안
            </p>
            {pending.offerCard && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '0.75rem 0' }}>
                <GameCard card={pending.offerCard} formulas={formulas} size="lg" />
              </div>
            )}
            <p>내줄 카드를 고르세요. 거절 시 상대는 다른 행동을 고를 수 있습니다.</p>
            <div className="hand-fan">
              {(state.myHand || []).map((c) => (
                <GameCard
                  key={c.id}
                  card={c}
                  formulas={formulas}
                  size="md"
                  selected={tradeResponseCard === c.id}
                  onClick={() => setTradeResponseCard(c.id)}
                />
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={acceptTrade}>
                수락
              </button>
              <button type="button" className="btn" onClick={rejectTrade}>
                거절
              </button>
            </div>
          </div>
        </div>
      )}

      {pending?.type === 'trade' && pending.amProposer && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {pending.toName} 응답 대기…
          <button type="button" className="btn btn--ghost-ink" style={{ marginLeft: 8 }} onClick={cancelTrade}>
            취소
          </button>
        </div>
      )}

      {/* Felt: opponents + workstations */}
      <div className="felt">
        <p className="felt__section-label">연구자들 · 워크스테이션</p>
        <div className="opponents" style={{ alignItems: 'flex-start' }}>
          {state.players.map((p) => (
            <div
              key={p.id}
              className={`opponent ${p.id === state.turnPlayerId ? 'is-turn' : ''} ${!p.connected ? 'is-offline' : ''} ${p.isMe ? 'opponent--me' : ''}`}
              style={{ minWidth: 100, maxWidth: 160 }}
            >
              <div className="opponent__name">
                {p.name}
                {p.isMe ? ' (나)' : ''}
                <small>
                  손 {p.handCount}장 · WS {(p.workstation || []).length}
                  {!p.connected ? ' · 오프라인' : ''}
                </small>
              </div>
              {!p.isMe && (
                <div className="opponent__pile" style={{ height: 72, width: 64, marginBottom: 6 }}>
                  {Array.from({ length: Math.min(3, Math.max(1, p.handCount || 0)) }).map((_, i) => (
                    <CardBack key={i} size="sm" />
                  ))}
                </div>
              )}
              <div className="ws-row">
                {(p.workstation || []).length === 0 && (
                  <span className="empty-discard" style={{ padding: 4, fontSize: 11 }}>
                    워크스테이션 비어 있음
                  </span>
                )}
                {(p.workstation || []).map((slot) => (
                  <GameCard
                    key={`${p.id}-ws-${slot.index}`}
                    card={slot.card}
                    formulas={formulas}
                    size="sm"
                    selected={
                      action === 'syringe' &&
                      syringeMode === 'workstation' &&
                      stealTarget === p.id &&
                      wsPick === slot.index
                    }
                    onClick={
                      state.isMyTurn &&
                      action === 'syringe' &&
                      syringeMode === 'workstation' &&
                      !p.isMe
                        ? () => {
                            setStealTarget(p.id);
                            setWsPick(slot.index);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shared-zone" style={{ marginTop: 12 }}>
          <div className="box-token">
            <strong>SEALED</strong>
            <strong>ANTIDOTE</strong>
            <span>X 1장 봉인</span>
          </div>
        </div>
      </div>

      {/* Hand */}
      <div className="hand-dock">
        <div className="hand-dock__panel">
          <div className="hand-dock__head">
            <h2>
              내 손패 · {me?.name} ({(state.myHand || []).length}장)
            </h2>
            <span className="hand-dock__hint">
              마지막 한 장이 해독제 공식이어야 합니다
            </span>
          </div>
          <div className="hand-fan">
            {(state.myHand || []).map((c) => (
              <GameCard
                key={c.id}
                card={c}
                formulas={formulas}
                size="md"
                selected={selectedCardId === c.id}
                onClick={
                  state.isMyTurn && !pending
                    ? () => setSelectedCardId(c.id)
                    : pending?.needSelect
                      ? () => setSelectedCardId(c.id)
                      : undefined
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions — only on your turn, no pending */}
      {state.isMyTurn && !pending && (
        <div className="console">
          <div className="console__panel">
            <div className="console__tabs">
              {[
                ['discard', '1. 버리기'],
                ['pass', '2A. 전원 패스'],
                ['trade', '2B. 1:1 거래'],
                ['syringe', '3. 주사기'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn ${action === id ? 'is-on' : ''}`}
                  onClick={() => setAction(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {action === 'discard' && (
              <>
                <p className="console__help">
                  <strong>전원</strong>이 손에서 1장씩 각자 워크스테이션에 버립니다. 동시 공개. X는
                  뒷면.
                </p>
                <button type="button" className="btn btn--primary" onClick={beginDiscard}>
                  전원 버리기 선언
                </button>
              </>
            )}

            {action === 'pass' && (
              <>
                <p className="console__help">
                  전원이 손의 카드 1장을 옆 사람에게 패스합니다. 건넨 뒤에 받은 카드를 봅니다.
                </p>
                <div className="btn-row">
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={() => beginPass('left')}>
                    왼쪽(이전 순서)으로
                  </button>
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={() => beginPass('right')}>
                    오른쪽(다음 순서)으로
                  </button>
                </div>
              </>
            )}

            {action === 'trade' && (
              <>
                <p className="console__help">
                  한 명과 손패 1:1. 거절되면 <strong>턴을 유지</strong>하고 다른 행동을 고를 수
                  있습니다.
                </p>
                <label>
                  상대 (투명 플레이어와는 거래 불가)
                  <select value={tradeTarget} onChange={(e) => setTradeTarget(e.target.value)}>
                    <option value="">선택…</option>
                    {others
                      .filter((p) => p.connected)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button type="button" className="btn btn--primary" onClick={doTrade}>
                  거래 제안 (손패에서 줄 카드 선택)
                </button>
              </>
            )}

            {action === 'syringe' && (
              <>
                <p className="console__help">
                  손의 주사기를 소모합니다. 상대 손(랜덤) 또는 워크스테이션(선택)에서 1장. 주사기는
                  상대 WS에 앞면으로 남습니다.
                  {!hasSyringe && ' — 지금 손에 주사기 없음.'}
                </p>
                <div className="console__tabs">
                  <button
                    type="button"
                    className={`btn ${syringeMode === 'hand' ? 'is-on' : ''}`}
                    onClick={() => setSyringeMode('hand')}
                  >
                    손패 훔치기
                  </button>
                  <button
                    type="button"
                    className={`btn ${syringeMode === 'workstation' ? 'is-on' : ''}`}
                    onClick={() => setSyringeMode('workstation')}
                  >
                    워크스테이션
                  </button>
                </div>
                <label>
                  대상 (투명 플레이어 포함 가능)
                  <select
                    value={stealTarget}
                    onChange={(e) => {
                      setStealTarget(e.target.value);
                      setWsPick(null);
                    }}
                  >
                    <option value="">선택…</option>
                    {syringeTargets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (손 {p.handCount} · WS {(p.workstation || []).length})
                      </option>
                    ))}
                  </select>
                </label>
                {syringeMode === 'workstation' && (
                  <p className="console__help">
                    위 테이블에서 상대 워크스테이션 카드를 터치해 고르세요.
                    {wsPick != null ? ` (선택 #${wsPick + 1})` : targetWs.length ? '' : ' (비어 있음)'}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={doSyringe}
                  disabled={!hasSyringe}
                >
                  주사기 사용
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="log-rail">
        <div className="log-rail__inner">
          <ul>
            {(state.log || [])
              .slice()
              .reverse()
              .map((l, i) => (
                <li key={i}>{l.message}</li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
