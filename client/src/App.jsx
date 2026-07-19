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

const SAMPLE_CARDS = [
  {
    id: 's1',
    type: 'number',
    formulaId: 'A',
    value: 3,
    label: '적철독 3',
    symbol: 'skull',
    name: '적철독',
    nameEn: 'Ferric',
  },
  {
    id: 's2',
    type: 'x',
    formulaId: 'B',
    label: '청람독 X',
    symbol: 'drop',
    name: '청람독',
    nameEn: 'Azure',
  },
  {
    id: 's3',
    type: 'syringe',
    label: '주사기',
    symbol: 'syringe',
  },
  {
    id: 's4',
    type: 'number',
    formulaId: 'E',
    value: 1,
    label: '자정독 1',
    symbol: 'crystal',
    name: '자정독',
    nameEn: 'Violet',
  },
];

const SAMPLE_FORMULAS = [
  { id: 'A', name: '적철독', nameEn: 'Ferric', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', name: '청람독', nameEn: 'Azure', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', name: '녹청독', nameEn: 'Viridian', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', name: '호박독', nameEn: 'Amber', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', name: '자정독', nameEn: 'Violet', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', name: '주황독', nameEn: 'Rust', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', name: '청록독', nameEn: 'Teal', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
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
  const [syringeMode, setSyringeMode] = useState('discard');
  const [stealTarget, setStealTarget] = useState('');
  const [discardPick, setDiscardPick] = useState(null);
  const [adminFormula, setAdminFormula] = useState('A');
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
    setInfo('이전 자리로 재접속하는 중…');
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
      setTimeout(() => setInfo(''), 2200);
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
      setInfo('연결이 끊겼습니다. 재연결을 시도합니다…');
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
    setDiscardPick(null);
    setTradeResponseCard(null);
  }, [state?.turnPlayerId, state?.status]);

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
      setInfo('테이블에서 일어났습니다.');
    });
  };

  const startGame = () => getSocket().emit('startGame', (res) => applyAck(res));

  const others = useMemo(() => (state?.players || []).filter((p) => !p.isMe), [state]);
  const me = useMemo(() => (state?.players || []).find((p) => p.isMe), [state]);

  const doDiscard = () => {
    if (!selectedCardId) return setError('버릴 카드를 손패에서 고르세요.');
    getSocket().emit('discard', { cardId: selectedCardId }, (res) => {
      if (applyAck(res)) setSelectedCardId(null);
    });
  };

  const doTrade = () => {
    if (!selectedCardId) return setError('상대에게 줄 카드를 고르세요.');
    if (!tradeTarget) return setError('거래 상대를 고르세요.');
    getSocket().emit('proposeTrade', { toId: tradeTarget, offerCardId: selectedCardId }, (res) =>
      applyAck(res)
    );
  };

  const doSyringe = () => {
    if (syringeMode === 'discard') {
      const idx =
        discardPick != null
          ? discardPick
          : state?.discardPile?.length
            ? state.discardPile.length - 1
            : undefined;
      getSocket().emit('useSyringe', { mode: 'discard', discardIndex: idx }, (res) => {
        if (applyAck(res)) setDiscardPick(null);
      });
    } else {
      if (!stealTarget) return setError('훔칠 대상을 고르세요.');
      getSocket().emit(
        'useSyringe',
        { mode: 'steal', targetPlayerId: stealTarget },
        (res) => applyAck(res)
      );
    }
  };

  const doAdminister = () => {
    const f = formulas.find((x) => x.id === adminFormula);
    const label = f ? f.name : adminFormula;
    if (
      !window.confirm(
        `「${label}」이(가) 해독제라고 확신합니까?\n투여하는 순간 한 판이 끝나고, 진짜 해독제 공식 카드를 든 사람만 생존합니다.`
      )
    )
      return;
    getSocket().emit('administer', { formulaId: adminFormula }, (res) => applyAck(res));
  };

  const acceptTrade = () => {
    if (!tradeResponseCard) return setError('상대에게 내줄 카드를 고르세요.');
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
    setInfo('방 코드를 복사했습니다.');
    setTimeout(() => setInfo(''), 1500);
  };

  // ═══════════ LANDING ═══════════
  if (!state) {
    return (
      <div className="app app--landing">
        <div className="wrap">
          <header className="landing-hero">
            <p className="landing-hero__badge">Tabletop multiplayer</p>
            <h1>
              해독제 <em>Antidote</em>
            </h1>
            <p className="landing-hero__lead">
              실험실에 독이 퍼졌습니다. 일곱 가지 독 중 하나만 진짜 해독제입니다. 카드를 읽고,
              거래를 하고, 거짓말을 걸러낸 뒤 — 살아남으세요.
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

          <div className="formula-strip">
            {SAMPLE_FORMULAS.map((f) => (
              <FormulaChip key={f.id} formula={f} size="sm" />
            ))}
          </div>

          <div className="landing-grid">
            <div>
              {session?.sessionToken && (
                <div className="panel panel--dark" style={{ marginBottom: '1rem' }}>
                  <h2>이어하기</h2>
                  <p style={{ margin: '0 0 0.75rem', opacity: 0.75, fontSize: '0.9rem' }}>
                    방 코드 <strong style={{ letterSpacing: '0.15em' }}>{session.roomCode || '?'}</strong>
                  </p>
                  <div className="btn-row">
                    <button type="button" className="btn btn--gold" onClick={tryReconnect} disabled={!connected}>
                      테이블로 돌아가기
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
                  <input
                    value={name}
                    maxLength={16}
                    onChange={(e) => saveName(e.target.value)}
                    placeholder="표시 이름"
                    autoComplete="nickname"
                  />
                </label>
                <button type="button" className="btn btn--primary" onClick={createRoom} disabled={!connected}>
                  새 방 만들기
                </button>
                <div className="divider">또는 코드로 합류</div>
                <label>
                  방 코드
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ABCD"
                    maxLength={6}
                    autoCapitalize="characters"
                  />
                </label>
                <button type="button" className="btn" onClick={joinRoom} disabled={!connected} style={{ width: '100%' }}>
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

          <p className="fine">
            학습용 웹 구현 · 원작 Bellwether Games Antidote · 인쇄용 카드 식별(색·심볼·이름) 기준
            디자인
          </p>
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
            <div>
              <h1>대기실</h1>
            </div>
            <div className="table-topbar__meta">
              <span className="room-code">{state.code}</span>
              <button type="button" className="btn btn--ghost" onClick={() => copyCode(state.code)}>
                코드 복사
              </button>
              <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
                나가기
              </button>
            </div>
          </div>

          <div className="landing-grid">
            <div className="panel panel--dark">
              <h2>좌석 ({state.players.length}/6)</h2>
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
                        {p.connected ? '접속 중' : '오프라인'}
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
                  카드 나누고 시작 (접속 2명+)
                </button>
              ) : (
                <p style={{ opacity: 0.65, margin: 0 }}>호스트가 판을 열기를 기다리는 중…</p>
              )}
              {error && <p className="msg-error">{error}</p>}
              {info && <p className="msg-info">{info}</p>}
            </div>
            <div className="panel">
              <RulesPanel compact />
              <div className="sample-hand" style={{ marginTop: '1rem' }}>
                {SAMPLE_CARDS.slice(0, 3).map((c) => (
                  <GameCard key={c.id} card={c} formulas={formulas} size="sm" />
                ))}
              </div>
            </div>
          </div>

          <div className="log-rail" style={{ marginTop: '1rem' }}>
            <div className="log-rail__inner">
              <ul>
                {(state.log || []).map((l, i) => (
                  <li key={i}>{l.message}</li>
                ))}
              </ul>
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
            <p style={{ opacity: 0.75, margin: 0 }}>봉인되어 있던 진짜 해독제</p>
            <div className="end-reveal">
              {trueF && (
                <GameCard
                  size="xl"
                  formulas={formulas}
                  card={{
                    id: 'reveal',
                    type: 'x',
                    formulaId: trueF.id,
                    label: trueF.name,
                    symbol: trueF.symbol,
                    name: trueF.name,
                    nameEn: trueF.nameEn,
                  }}
                />
              )}
            </div>
            <p>
              생존자:{' '}
              <strong>{state.winnerNames?.length ? state.winnerNames.join(', ') : '없음'}</strong>
            </p>
          </header>

          <div className="panel hands-reveal">
            <h2 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>모든 손패 공개</h2>
            {state.players.map((p) => (
              <div
                key={p.id}
                className={`hands-reveal__block ${(state.winners || []).includes(p.id) ? 'is-winner' : ''}`}
              >
                <h3>
                  {p.name}
                  {p.isMe ? ' (나)' : ''}
                </h3>
                <div className="hand-fan" style={{ minHeight: 0, justifyContent: 'flex-start' }}>
                  {(state.allHands?.[p.id] || []).map((c) => (
                    <GameCard key={c.id} card={c} formulas={formulas} size="sm" />
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="btn btn--primary" onClick={leaveRoom}>
              로비로 나가기
            </button>
          </div>

          <div className="log-rail" style={{ marginTop: '1rem' }}>
            <div className="log-rail__inner">
              <ul>
                {(state.log || []).map((l, i) => (
                  <li key={i}>{l.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ PLAYING ═══════════
  const turnName = state.players.find((p) => p.id === state.turnPlayerId)?.name || '?';
  const hasSyringe = (state.myHand || []).some((c) => c.type === 'syringe');

  return (
    <div className="app app--table">
      <header className="table-topbar">
        <div>
          <h1>해독제 · 실험 테이블</h1>
        </div>
        <div className="table-topbar__meta">
          <span className="room-code">{state.code}</span>
          <div className={`turn-badge ${state.isMyTurn ? 'is-mine' : ''}`}>
            {state.isMyTurn ? '당신 차례' : `${turnName} 차례`}
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setShowRules((v) => !v)}>
            규칙
          </button>
          <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
            나가기
          </button>
        </div>
      </header>

      {!connected && (
        <div className="banner banner--warn">오프라인 — 손패는 서버에 보존됩니다. 재연결 중…</div>
      )}
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
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <RulesPanel />
            <button type="button" className="btn btn--primary" style={{ marginTop: '1rem' }} onClick={() => setShowRules(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {state.pendingTrade?.amTarget && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-labelledby="trade-title">
            <h2 id="trade-title">거래 제안</h2>
            <p>
              <strong>{state.pendingTrade.fromName}</strong> 님이 카드 교환을 제안했습니다.
            </p>
            {state.pendingTrade.offerCard && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '0.75rem 0' }}>
                <GameCard card={state.pendingTrade.offerCard} formulas={formulas} size="lg" />
              </div>
            )}
            <p>당신이 내줄 카드를 고른 뒤 수락하세요. (거절하면 상대 턴이 유지됩니다.)</p>
            <div className="hand-fan" style={{ minHeight: 0 }}>
              {state.myHand.map((c) => (
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
            <div className="btn-row" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={acceptTrade}>
                수락 · 교환
              </button>
              <button type="button" className="btn" onClick={rejectTrade}>
                거절
              </button>
            </div>
          </div>
        </div>
      )}

      {state.pendingTrade?.amProposer && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {state.pendingTrade.toName} 님의 응답을 기다리는 중…
          <button type="button" className="btn btn--ghost-ink" style={{ marginLeft: 8 }} onClick={cancelTrade}>
            제안 취소
          </button>
        </div>
      )}

      {/* Felt table */}
      <div className="felt">
        <p className="felt__section-label">상대 연구자</p>
        <div className="opponents">
          {others.map((p) => {
            const n = Math.min(3, Math.max(1, p.handCount || 0));
            return (
              <div
                key={p.id}
                className={`opponent ${p.id === state.turnPlayerId ? 'is-turn' : ''} ${!p.connected ? 'is-offline' : ''}`}
              >
                <div className="opponent__name">
                  {p.name}
                  <small>
                    {p.handCount}장{!p.connected ? ' · 오프라인' : ''}
                  </small>
                </div>
                <div className="opponent__pile">
                  {Array.from({ length: n }).map((_, i) => (
                    <CardBack key={i} size="sm" />
                  ))}
                </div>
              </div>
            );
          })}
          {others.length === 0 && (
            <p className="empty-discard">다른 플레이어가 없습니다.</p>
          )}
        </div>

        <p className="felt__section-label">공유 영역</p>
        <div className="shared-zone">
          <div className="box-token" title="봉인된 해독제">
            <strong>SEALED</strong>
            <strong>ANTIDOTE</strong>
            <span>내용 미공개</span>
          </div>
          <div className="discard-well">
            <p className="felt__section-label" style={{ marginBottom: 6 }}>
              버린 카드 · {state.discardPile.length}장
              {action === 'syringe' && syringeMode === 'discard' && state.isMyTurn
                ? ' · 가져올 카드 터치'
                : ''}
            </p>
            <div
              className={`discard-row ${
                action === 'syringe' && syringeMode === 'discard' && state.isMyTurn
                  ? 'discard-row--pick'
                  : ''
              }`}
            >
              {state.discardPile.length === 0 && (
                <p className="empty-discard">아직 공개된 연구 없음</p>
              )}
              {state.discardPile.map((c, i) => (
                <GameCard
                  key={`${c.id}-${i}`}
                  card={c}
                  formulas={formulas}
                  size="sm"
                  selected={discardPick === i}
                  onClick={
                    action === 'syringe' && syringeMode === 'discard' && state.isMyTurn
                      ? () => setDiscardPick(i)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Formula legend */}
      <div className="legend-bar">
        {formulas.map((f) => (
          <FormulaChip
            key={f.id}
            formula={f}
            eliminated={(state.eliminatedFormulas || []).includes(f.id)}
            size="sm"
          />
        ))}
      </div>

      {/* My hand */}
      <div className="hand-dock">
        <div className="hand-dock__panel">
          <div className="hand-dock__head">
            <h2>내 손패 · {me?.name || '나'}</h2>
            <span className="hand-dock__hint">
              {state.isMyTurn
                ? '카드를 고른 뒤 아래 행동을 선택하세요'
                : '다른 연구자의 차례 — 버린 카드를 관찰하세요'}
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
                  state.isMyTurn && !state.pendingTrade
                    ? () => setSelectedCardId(c.id)
                    : undefined
                }
              />
            ))}
          </div>
          {(state.eliminatedFormulas || []).length > 0 && (
            <div className="elim-row">
              <span className="elim-row__label">손의 X로 배제한 독 (해독제 아님)</span>
              {formulas
                .filter((f) => state.eliminatedFormulas.includes(f.id))
                .map((f) => (
                  <FormulaChip key={f.id} formula={f} eliminated size="sm" />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {state.isMyTurn && !state.pendingTrade && (
        <div className="console">
          <div className="console__panel">
            <div className="console__tabs">
              {[
                ['discard', '버리기'],
                ['trade', '거래'],
                ['syringe', '주사기'],
                ['administer', '해독제 투여'],
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
                  선택한 카드를 <strong>공개 더미</strong>에 버립니다. 모두가 내용을 봅니다. 정보와
                  동시에 손에서 잃는 트레이드오프입니다.
                </p>
                <button type="button" className="btn btn--primary" onClick={doDiscard}>
                  선택한 카드 공개 버리기
                </button>
              </>
            )}

            {action === 'trade' && (
              <>
                <p className="console__help">
                  손에서 줄 카드를 고른 뒤, 접속 중인 상대를 지정합니다. 상대가 수락하면 카드가
                  맞교환됩니다.
                </p>
                <label>
                  거래 상대
                  <select value={tradeTarget} onChange={(e) => setTradeTarget(e.target.value)}>
                    <option value="">선택…</option>
                    {others
                      .filter((p) => p.connected)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.handCount}장)
                        </option>
                      ))}
                  </select>
                </label>
                <button type="button" className="btn btn--primary" onClick={doTrade}>
                  거래 제안하기
                </button>
              </>
            )}

            {action === 'syringe' && (
              <>
                <p className="console__help">
                  손의 <strong>주사기</strong>를 소모합니다.
                  {hasSyringe
                    ? ' 버린 카드 더미에서 고르거나, 상대 손패를 무작위로 훔칩니다.'
                    : ' — 지금 손에 주사기가 없습니다.'}
                </p>
                <div className="console__tabs">
                  <button
                    type="button"
                    className={`btn ${syringeMode === 'discard' ? 'is-on' : ''}`}
                    onClick={() => setSyringeMode('discard')}
                  >
                    버린 카드 가져오기
                  </button>
                  <button
                    type="button"
                    className={`btn ${syringeMode === 'steal' ? 'is-on' : ''}`}
                    onClick={() => setSyringeMode('steal')}
                  >
                    상대 손 훔치기
                  </button>
                </div>
                {syringeMode === 'steal' && (
                  <label>
                    대상
                    <select value={stealTarget} onChange={(e) => setStealTarget(e.target.value)}>
                      <option value="">선택…</option>
                      {others.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.handCount}장)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {syringeMode === 'discard' && (
                  <p className="console__help">
                    위 버린 카드 중 하나를 터치해 고르세요. 고르지 않으면 가장 최근 카드입니다.
                    {discardPick != null ? ` (선택 #${discardPick + 1})` : ''}
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

            {action === 'administer' && (
              <>
                <p className="console__help">
                  확신이 들 때만 사용하세요. 게임이 <strong>즉시 종료</strong>되고, 당신이 고른
                  독이 아니라 <strong>진짜 봉인된 해독제</strong> 카드를 든 사람이 생존합니다.
                </p>
                <div className="formula-strip" style={{ justifyContent: 'flex-start', margin: '0 0 0.75rem' }}>
                  {formulas.map((f) => (
                    <FormulaChip
                      key={f.id}
                      formula={f}
                      selected={adminFormula === f.id}
                      eliminated={(state.eliminatedFormulas || []).includes(f.id)}
                      onClick={() => setAdminFormula(f.id)}
                      size="md"
                    />
                  ))}
                </div>
                <button type="button" className="btn btn--danger" onClick={doAdminister}>
                  해독제 투여 · 판 종료
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
