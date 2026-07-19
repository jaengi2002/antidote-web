import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { CardBack, FormulaChip, GameCard } from './components/GameCard';
import { RulesPanel } from './components/RulesPanel';
import { sfx, getMuted, setMuted as setMutedStore } from './sounds';
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
  { id: 'A', name: '해골', nameEn: 'Skull', color: '#8B1E1E', colorSoft: '#F5E6E6', ink: '#4A0F0F', symbol: 'skull' },
  { id: 'B', name: '물방울', nameEn: 'Drop', color: '#1B4F72', colorSoft: '#E6F0F5', ink: '#0D2A3D', symbol: 'drop' },
  { id: 'C', name: '이파리', nameEn: 'Leaf', color: '#1E6B3A', colorSoft: '#E6F5EC', ink: '#0D3A1C', symbol: 'leaf' },
  { id: 'D', name: '위험', nameEn: 'Hazard', color: '#8B6914', colorSoft: '#F7F1DE', ink: '#4A3808', symbol: 'bio' },
  { id: 'E', name: '수정', nameEn: 'Crystal', color: '#5B2C6F', colorSoft: '#F0E6F5', ink: '#2E1538', symbol: 'crystal' },
  { id: 'F', name: '불꽃', nameEn: 'Flame', color: '#A04000', colorSoft: '#F8EBE0', ink: '#5A2400', symbol: 'flame' },
  { id: 'G', name: '분자', nameEn: 'Molecule', color: '#0E6655', colorSoft: '#E0F5F1', ink: '#063D33', symbol: 'molecule' },
];

const SAMPLE_CARDS = [
  { id: 's1', type: 'number', formulaId: 'A', value: 3, label: '해골 3', symbol: 'skull', name: '해골', nameEn: 'Skull' },
  { id: 's2', type: 'x', formulaId: 'B', label: '물방울 X', symbol: 'drop', name: '물방울', nameEn: 'Drop' },
  { id: 's3', type: 'syringe', label: '주사', symbol: 'syringe', name: '주사', nameEn: 'Syringe' },
];

export default function App() {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem('antidote_name') || '');
  const [joinCode, setJoinCode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '';
    } catch {
      return '';
    }
  });
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
  const [muted, setMutedState] = useState(() => getMuted());
  const toastTimer = useRef(null);

  const formulas = state?.formulas?.length ? state.formulas : SAMPLE_FORMULAS;

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMutedStore(next);
  };

  const showToast = useCallback((msg, kind = 'info') => {
    if (kind === 'error') setError(msg);
    else setInfo(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setError('');
      setInfo('');
    }, 3200);
  }, []);

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
        showToast(res?.error || '요청 실패', 'error');
        return false;
      }
      if (res.sessionToken) persistSession(res);
      if (res.state) setState(res.state);
      setError('');
      return true;
    },
    [persistSession, showToast]
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
      setInfo('연결이 끊겼습니다. 자동 재연결 중… 같은 브라우저면 세션으로 다시 붙습니다.');
    };
    const onState = (view) => {
      setState((prev) => {
        // sounds
        if (prev?.status === 'playing' && view?.status === 'ended') sfx.end();
        else if (view?.pending?.type === 'massDiscard' && prev?.pending?.type !== 'massDiscard')
          sfx.discard();
        else if (view?.pending?.type === 'massPass' && prev?.pending?.type !== 'massPass')
          sfx.receive();
        else if (view?.isMyTurn && !prev?.isMyTurn) sfx.click();
        return view;
      });
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
    getSocket().emit('createRoom', { name: name.trim() }, (res) => {
      if (applyAck(res) && res.roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', res.roomCode);
        window.history.replaceState({}, '', url.toString());
      }
    });
  };

  const joinRoom = () => {
    if (!name.trim()) return setError('닉네임을 입력하세요.');
    if (!joinCode.trim()) return setError('방 코드를 입력하세요.');
    getSocket().emit('joinRoom', { code: joinCode.trim(), name: name.trim() }, (res) => {
      if (applyAck(res) && res.roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', res.roomCode);
        window.history.replaceState({}, '', url.toString());
      }
    });
  };

  const copyInvite = (code) => {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    navigator.clipboard?.writeText(url);
    showToast('초대 링크를 복사했습니다');
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
    showToast('방 코드를 복사했습니다');
  };

  const chrome = (
    <div className="chrome-bar" aria-label="빠른 설정">
      <button
        type="button"
        className={`btn ${muted ? '' : 'is-on'}`}
        onClick={toggleMute}
        aria-pressed={!muted}
        title={muted ? '소리 켜기' : '소리 끄기'}
      >
        {muted ? '소리 끔' : '소리 켬'}
      </button>
    </div>
  );

  const toasts = (
    <div className="toast-stack" aria-live="polite">
      {error && <div className="toast toast--error">{error}</div>}
      {info && !error && <div className="toast toast--info">{info}</div>}
    </div>
  );

  const hasSyringe = (state?.myHand || []).some((c) => c.type === 'syringe');
  const targetWs =
    syringeTargets.find((p) => p.id === stealTarget)?.workstation || [];

  // ═══════════ LANDING ═══════════
  if (!state) {
    return (
      <div className="app app--landing">
        <a className="skip-link" href="#main-play">
          플레이로 건너뛰기
        </a>
        {chrome}
        {toasts}
        <div className="wrap">
          <header className="landing-hero">
            <p className="landing-hero__badge">2–7인 · 방 코드 멀티</p>
            <h1>
              해독제 <em>Antidote</em>
            </h1>
            <p className="landing-hero__lead">
              독이 퍼진 실험실. 마지막에 손에 남은 한 장이 진짜 해독제면 살아남습니다. 버리기,
              돌리기, 바꾸기, 주사로 정보를 모으세요.
            </p>
            <div className="landing-features">
              <span>실시간 멀티</span>
              <span>초대 링크</span>
              <span>봇 연습</span>
              <span>관전 지원</span>
            </div>
            <div className={`conn-pill ${connected ? 'is-on' : ''}`}>
              <span className="conn-pill__dot" />
              {connected ? '서버 연결됨' : '서버 연결 중… (첫 접속은 수십 초 걸릴 수 있어요)'}
              {reconnecting ? ' · 재접속' : ''}
            </div>
            {!connected && (
              <p className="wake-hint">
                무료 호스팅은 잠깐 잠들 수 있습니다. 연결될 때까지 잠시만 기다려 주세요.
              </p>
            )}
          </header>

          <div className="sample-hand" aria-hidden>
            {SAMPLE_CARDS.map((c) => (
              <GameCard key={c.id} card={c} formulas={SAMPLE_FORMULAS} size="md" />
            ))}
          </div>

          <div className="landing-grid" id="main-play">
            <div>
              {session?.sessionToken && (
                <div className="panel panel--dark panel--elevated" style={{ marginBottom: '1rem' }}>
                  <h2>이어하기</h2>
                  <p style={{ margin: '0 0 0.75rem', opacity: 0.75, fontSize: '0.9rem' }}>
                    방 <strong style={{ letterSpacing: '0.15em' }}>{session.roomCode || '?'}</strong>
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
              <div className="panel panel--elevated">
                <h2>테이블 잡기</h2>
                <label>
                  닉네임
                  <input
                    value={name}
                    maxLength={16}
                    onChange={(e) => saveName(e.target.value)}
                    placeholder="표시 이름"
                    autoComplete="nickname"
                    enterKeyHint="done"
                  />
                </label>
                <button type="button" className="btn btn--primary" onClick={createRoom} disabled={!connected || !name.trim()}>
                  새 방 만들기
                </button>
                <div className="divider">또는 코드·링크로 입장</div>
                <label>
                  방 코드
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    placeholder="ABCD"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={joinRoom}
                  disabled={!connected || !name.trim() || !joinCode.trim()}
                >
                  입장
                </button>
              </div>
            </div>
            <div className="panel">
              <RulesPanel />
            </div>
          </div>
          <p className="fine">
            학습용 웹 구현 · 본작 Antidote 규칙 기반 · 아트·명칭은 자체 테마
          </p>
        </div>
      </div>
    );
  }

  // ═══════════ LOBBY ═══════════
  if (state.status === 'lobby') {
    // hostId / me / isHost 중 하나라도 맞으면 호스트로 취급 (호환)
    const iAmHost =
      state.hostId === state.me ||
      state.hostid === state.me ||
      !!(state.players || []).find((p) => p.isMe && p.isHost);
    const connectedCount = (state.players || []).filter((p) => p.connected).length;
    const canStart = connectedCount >= 2;
    return (
      <div className="app lobby-shell">
        {chrome}
        {toasts}
        <div className="wrap">
          <div className="table-topbar" style={{ borderRadius: 12, marginBottom: '1rem' }}>
            <h1>대기실</h1>
            <div className="table-topbar__meta">
              <span className="room-code">{state.code}</span>
              <button type="button" className="btn btn--ghost" onClick={() => copyCode(state.code)}>
                코드
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => copyInvite(state.code)}>
                초대 링크
              </button>
              <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
                나가기
              </button>
            </div>
          </div>
          <div className="landing-grid">
            <div className="panel panel--dark panel--elevated">
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
                        {p.isBot ? '봇 · ' : ''}
                        {p.connected ? '접속' : '오프라인'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {iAmHost && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: '100%', marginBottom: 10 }}
                    onClick={() => getSocket().emit('addBot', (res) => applyAck(res))}
                    disabled={state.players.length >= 7}
                  >
                    봇 추가 (혼자 연습)
                  </button>
                  <p style={{ fontSize: 13, opacity: 0.8, margin: '0 0 8px' }}>
                    확장 (순수 2인이면 시작 시 자동 OFF · 봇 있으면 유지)
                  </p>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, textTransform: 'none', letterSpacing: 0, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={!!state.expansionPlacebo}
                      onChange={(e) =>
                        getSocket().emit(
                          'setExpansions',
                          {
                            placebo: e.target.checked,
                            romance: !!state.expansionRomance,
                          },
                          (res) => applyAck(res)
                        )
                      }
                    />
                    속임수 약 확장 (담당 표·임상·속임수 약)
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={!!state.expansionRomance}
                      onChange={(e) =>
                        getSocket().emit(
                          'setExpansions',
                          {
                            placebo: !!state.expansionPlacebo,
                            romance: e.target.checked,
                          },
                          (res) => applyAck(res)
                        )
                      }
                    />
                    비밀 목표
                  </label>
                </div>
              )}
              {!iAmHost && (
                <p style={{ fontSize: 13, opacity: 0.75 }}>
                  확장: 속임수 약 {state.expansionPlacebo ? 'ON' : 'OFF'} · 비밀 목표{' '}
                  {state.expansionRomance ? 'ON' : 'OFF'}
                </p>
              )}
              {iAmHost ? (
                <>
                  <button
                    type="button"
                    className="btn btn--gold"
                    onClick={startGame}
                    disabled={!canStart}
                  >
                    게임 시작
                  </button>
                  {!canStart && (
                    <p style={{ opacity: 0.7, fontSize: 13, marginTop: 8 }}>
                      접속 인원 2명 이상이면 시작할 수 있어요. (지금 {connectedCount}명)
                    </p>
                  )}
                </>
              ) : (
                <p style={{ opacity: 0.65 }}>
                  호스트 시작 대기… (방 만든 사람에게만 「게임 시작」이 보입니다)
                </p>
              )}
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
        {chrome}
        {toasts}
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
            {state.players
              .filter((p) => !p.isSilent && p.id !== '__SILENT__' && !String(p.name || '').includes('투명'))
              .map((p) => {
              const sc = state.scores?.[p.id];
              return (
                <div
                  key={p.id}
                  className={`hands-reveal__block ${(state.winners || []).includes(p.id) ? 'is-winner' : ''}`}
                >
                  <h3>
                    {p.name}
                    {p.isMe ? ' (나)' : ''} · {sc?.score ?? 0}점
                    {sc?.survived ? ' · 생존' : ' · 사망'}
                    {state.allRomance?.[p.id] ? ` · ${state.allRomance[p.id].name}` : ''}
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
            {(state.scoreNotes || []).length > 0 && (
              <ul style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {state.scoreNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {state.seriesRound > 0 && (
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', margin: '0 0 6px' }}>
                  시리즈 누적 ({state.seriesRound}판)
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {state.players
                    .filter((p) => !p.isSilent && p.id !== '__SILENT__' && !String(p.name || '').includes('투명'))
                    .map((p) => (
                    <li key={p.id}>
                      {p.name}: {(state.seriesTotals || {})[p.id] ?? 0}점
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="btn-row">
              {(state.hostId === state.me ||
                !!(state.players || []).find((p) => p.isMe && p.isHost)) && (
                <button
                  type="button"
                  className="btn btn--gold"
                  style={{ flex: 1 }}
                  onClick={() => getSocket().emit('nextRound', (res) => applyAck(res))}
                >
                  한 판 더 (시리즈)
                </button>
              )}
              <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={leaveRoom}>
                로비로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ending_claudius uses playing UI with modal
  // ═══════════ PLAYING ═══════════
  const turnName = state.players.find((p) => p.id === state.turnPlayerId)?.name || '?';
  const pending = state.pending;
  const statusLine = state.statusLine || '';

  return (
    <div className="app app--table">
      {chrome}
      {toasts}
      <header className="table-topbar">
        <div>
          <h1>해독제</h1>
          {state.config && (
            <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 8 }}>
              약 {state.config.formulas}종 · 1–{state.config.maxNumber}
              {state.seriesRound ? ` · 시리즈 ${state.seriesRound}판+` : ''}
              {state.silentMode ? ' · 투명P' : ''}
            </span>
          )}
        </div>
        <div className="table-topbar__meta">
          <span className="room-code">{state.code}</span>
          <button type="button" className="btn btn--ghost" onClick={() => copyInvite(state.code)}>
            초대
          </button>
          <div className={`turn-badge ${state.isMyTurn ? 'is-mine' : ''}`}>
            {state.isMyTurn ? '당신 차례' : `${turnName} 차례`}
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
            규칙
          </button>
          <button type="button" className="btn btn--ghost" onClick={leaveRoom}>
            나가기
          </button>
        </div>
      </header>

      {statusLine && (
        <div className="status-banner" role="status">
          {statusLine}
        </div>
      )}

      {!connected && (
        <div className="banner banner--warn">
          오프라인 — 재연결 중… 같은 브라우저면 세션으로 자리 복구됩니다.
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
                ? '전원 동시에 내 앞으로 버립니다. X는 뒷면, 나머지는 앞면.'
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

      {pending?.type === 'clinicalDirection' && pending.amChooser && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>임상 실험 — 방향</h2>
            <p>전원 지정한 방향의 내 앞에서 카드 1장을 손으로 가져옵니다.</p>
            <div className="btn-row">
              {['left', 'right', 'self'].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn btn--primary"
                  style={{ flex: 1 }}
                  onClick={() =>
                    getSocket().emit('clinicalChooseDirection', { direction: d }, (res) =>
                      applyAck(res)
                    )
                  }
                >
                  {d === 'left' ? '왼쪽 내 앞' : d === 'right' ? '오른쪽 내 앞' : '내 앞'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pending?.type === 'clinicalDirection' && !pending.amChooser && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          {pending.name} 님이 임상 실험 방향을 고르는 중…
        </div>
      )}

      {pending?.type === 'clinicalPick' && pending.needSelect && (
        <div className="modal-backdrop">
          <div className="modal clinical-pick-modal">
            <h2>임상 실험 — 카드 가져오기</h2>
            <p className="clinical-pick-from">
              {pending.pickFromLabel ||
                `${pending.sourceName || '?'} 님의 내 앞에서 고르세요`}
            </p>
            <p className="clinical-pick-meta">
              방향: <strong>{pending.directionLabel || pending.direction}</strong>
              {' · '}
              출처:{' '}
              <strong className="clinical-source-name">
                {pending.sourceName === '나'
                  ? '내 앞'
                  : `${pending.sourceName} 님의 내 앞`}
              </strong>
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              임상 실험 카드는 고를 수 없습니다. 뒷면은 X 또는 속임수 약일 수 있습니다.
            </p>
            <div className="hand-fan">
              {(pending.options || []).map((o) => (
                <div key={o.index} className="clinical-option">
                  <span className="clinical-option__owner">
                    {o.sourceName === '나' ? '내 앞' : `${o.sourceName}`}
                  </span>
                  <GameCard
                    card={o.card}
                    formulas={formulas}
                    size="md"
                    onClick={() =>
                      getSocket().emit(
                        'clinicalPickCard',
                        { workstationIndex: o.index },
                        (res) => applyAck(res)
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pending?.type === 'clinicalPick' && !pending.needSelect && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          임상 선택 대기: {(pending.waitingNames || []).join(', ') || '…'}
        </div>
      )}

      {state.pendingPlaceboSwap?.active && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>속임수 약 발동!</h2>
            <p>손패 카드와 내 앞 카드를 1장씩 고르면 교환합니다. 패스도 가능합니다.</p>
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
            <p style={{ marginTop: 8 }}>내 내 앞 (교환할 칸 터치)</p>
            <div className="hand-fan">
              {(me?.workstation || []).map((slot) => (
                <GameCard
                  key={slot.index}
                  card={slot.card}
                  formulas={formulas}
                  size="sm"
                  selected={wsPick === slot.index}
                  onClick={() => setWsPick(slot.index)}
                />
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={() =>
                  getSocket().emit(
                    'placeboSwap',
                    { handCardId: selectedCardId, workstationIndex: wsPick },
                    (res) => applyAck(res)
                  )
                }
              >
                교환
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  getSocket().emit('placeboSwap', {}, (res) => applyAck(res))
                }
              >
                패스
              </button>
            </div>
          </div>
        </div>
      )}

      {pending?.type === 'claudiusPick' && pending.needMe && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>속임수 왕 — 마실 카드</h2>
            <p>내 앞에서 카드 1장을 고르세요. 이 카드가 당신이 마신 약이 됩니다.</p>
            <div className="hand-fan">
              {(me?.workstation || []).map((slot) => (
                <GameCard
                  key={slot.index}
                  card={slot.card}
                  formulas={formulas}
                  size="md"
                  onClick={() =>
                    getSocket().emit(
                      'claudiusPickWs',
                      { workstationIndex: slot.index },
                      (res) => applyAck(res)
                    )
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Felt: opponents + workstations */}
      <div className="felt">
        <p className="felt__section-label">플레이어 · 각자 내 앞</p>
        <div className="opponents" style={{ alignItems: 'flex-start' }}>
          {state.players.map((p) => (
            <div
              key={p.id}
              className={`opponent ${p.id === state.turnPlayerId ? 'is-turn' : ''} ${!p.connected ? 'is-offline' : ''} ${p.isMe ? 'opponent--me' : ''} ${p.isClinicalSource ? 'is-clinical-source' : ''}`}
              style={{ minWidth: 100, maxWidth: 160 }}
            >
              <div className="opponent__name">
                {p.name}
                {p.isMe ? ' (나)' : ''}
                <small>
                  손 {p.handCount}장 · 내 앞 {(p.workstation || []).length}
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
                    내 앞 비어 있음
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
            <strong>봉인</strong>
            <strong>해독제</strong>
            <span>X 1장</span>
          </div>
        </div>
      </div>

      {state.isSpectator && (
        <div className="banner banner--info" style={{ margin: '0.5rem auto', maxWidth: 960 }}>
          관전 모드입니다. 테이블·로그는 볼 수 있고, 손패와 행동은 없습니다.
          {state.status === 'ended'
            ? ' 호스트가 「한 판 더」를 누르면 다음 판 좌석에 앉을 수 있습니다.'
            : ''}
          {(state.spectators || []).length > 0 && (
            <span>
              {' '}
              관전 {(state.spectators || []).map((s) => s.name).join(', ')}
            </span>
          )}
        </div>
      )}

      {/* Hand */}
      {!state.isSpectator && (
      <div className="hand-dock">
        <div className="hand-dock__panel">
          <div className="hand-dock__head">
            <h2>
              내 손패 · {me?.name} ({(state.myHand || []).length}장)
            </h2>
            <span className="hand-dock__hint">
              {state.myRomance
                ? `비밀 목표: ${state.myRomance.name}`
                : '마지막 한 장이 해독제 공식이어야 합니다'}
              {state.myBadge
                ? ` · 담당 표: ${formulas.find((f) => f.id === state.myBadge.formulaId)?.name || state.myBadge.formulaId}`
                : ''}
            </span>
          </div>
          {state.myRomance && (
            <p className="hand-dock__hint" style={{ marginBottom: 8 }}>
              {state.myRomance.summary}
              {state.myRomance.id === 'othello' && (
                <>
                  {' '}
                  <select
                    value={state.othelloLoverId || ''}
                    onChange={(e) =>
                      getSocket().emit('setOthelloLover', { loverId: e.target.value }, (res) =>
                        applyAck(res)
                      )
                    }
                  >
                    <option value="">애인 지정…</option>
                    {others.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </p>
          )}
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

      )}

      {/* Actions — only on your turn, no pending */}
      {state.isMyTurn && !pending && !state.isSpectator && (
        <div className="console">
          <div className="console__panel">
            <div className="console__tabs">
              {[
                ['discard', '1. 버리기'],
                ['pass', '2. 전원 돌리기'],
                ['trade', '3. 한 명과 바꾸기'],
                ['syringe', '4. 주사'],
                ...(state.canDrawRomance ? [['romance', '5. 비밀 목표']] : []),
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
                  <strong>전원</strong>이 손에서 1장씩 각자 내 앞에 버립니다. 동시 공개. X는
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
                  <strong>모두</strong> 손의 카드 1장을 옆 사람에게 돌립니다. 건넨 뒤에야 받은
                  카드를 봅니다.
                </p>
                <div className="btn-row">
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={() => beginPass('left')}>
                    왼쪽으로 돌리기
                  </button>
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={() => beginPass('right')}>
                    오른쪽으로 돌리기
                  </button>
                </div>
              </>
            )}

            {action === 'trade' && (
              <>
                <p className="console__help">
                  한 사람과 손패 1장씩 맞바꿉니다. 거절되면 <strong>턴을 유지</strong>하고 다른
                  행동을 고를 수 있습니다.
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
                  손의 주사를 소모합니다. 상대 손(랜덤) 또는 내 앞(선택)에서 1장. 주사는
                  상대 내 앞에 앞면으로 남습니다.
                  {!hasSyringe && ' — 지금 손에 주사 없음.'}
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
                    내 앞
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
                        {p.name} (손 {p.handCount} · 내 앞 {(p.workstation || []).length})
                      </option>
                    ))}
                  </select>
                </label>
                {syringeMode === 'workstation' && (
                  <p className="console__help">
                    위 테이블에서 상대 내 앞 카드를 터치해 고르세요.
                    {wsPick != null ? ` (선택 #${wsPick + 1})` : targetWs.length ? '' : ' (비어 있음)'}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={doSyringe}
                  disabled={!hasSyringe}
                >
                  주사 사용
                </button>
              </>
            )}

            {action === 'romance' && (
              <>
                <p className="console__help">
                  비밀 목표 카드를 1장 뽑습니다 (게임당 1회, 비공개). 덱{' '}
                  {state.romanceDeckCount ?? 0}장.
                </p>
                <button
                  type="button"
                  className="btn btn--gold"
                  onClick={() => getSocket().emit('drawRomance', (res) => applyAck(res))}
                >
                  비밀 목표 카드 뽑기
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
