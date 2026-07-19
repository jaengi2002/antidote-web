import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
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

function formulaStyle(formulas, formulaId) {
  const f = formulas?.find((x) => x.id === formulaId);
  return {
    background: f?.color || '#555',
    color: formulaId === 'D' ? '#222' : '#fff',
  };
}

function CardView({ card, formulas, selected, onClick }) {
  if (!card) return null;
  const isSyringe = card.type === 'syringe';
  const style = isSyringe
    ? { background: '#2c3e50', color: '#ecf0f1' }
    : formulaStyle(formulas, card.formulaId);

  return (
    <button
      type="button"
      className={`card ${selected ? 'selected' : ''}`}
      style={style}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="card-label">{card.label}</span>
      <span className="card-type">
        {isSyringe ? 'SYRINGE' : card.type === 'x' ? 'TOXIN X' : `NO. ${card.value}`}
      </span>
    </button>
  );
}

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
  const [adminFormula, setAdminFormula] = useState('A');
  const [tradeResponseCard, setTradeResponseCard] = useState(null);

  const persistSession = useCallback((payload) => {
    if (!payload?.sessionToken) return;
    const next = {
      sessionToken: payload.sessionToken,
      playerId: payload.playerId,
      roomCode: payload.roomCode || payload.state?.code,
      name: name.trim(),
    };
    saveSession(next);
    setSession(next);
  }, [name]);

  const clearSessionLocal = useCallback(() => {
    saveSession(null);
    setSession(null);
    setState(null);
  }, []);

  const applyAck = useCallback(
    (res) => {
      if (!res?.ok) {
        setError(res?.error || '요청 실패');
        if (res?.error && /세션|방|만료/.test(res.error)) {
          // stale session
          if (res.error.includes('세션') || res.error.includes('방')) {
            // keep name; clear only if reconnect failed hard
          }
        }
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
    setInfo('이전 세션으로 재접속 중…');
    getSocket().emit('reconnectSession', { sessionToken: s.sessionToken }, (res) => {
      setReconnecting(false);
      if (!res?.ok) {
        setInfo('');
        setError(res?.error || '재접속 실패');
        saveSession(null);
        setSession(null);
        return;
      }
      setInfo('재접속되었습니다.');
      applyAck(res);
      setTimeout(() => setInfo(''), 2500);
    });
  }, [applyAck]);

  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      setConnected(true);
      // Auto rejoin seat after socket reconnect
      const sess = loadSession();
      if (sess?.sessionToken) tryReconnect();
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

  const startGame = () => getSocket().emit('startGame', (res) => applyAck(res) || null);

  const others = useMemo(
    () => (state?.players || []).filter((p) => !p.isMe),
    [state]
  );

  const doDiscard = () => {
    if (!selectedCardId) return setError('버릴 카드를 선택하세요.');
    getSocket().emit('discard', { cardId: selectedCardId }, (res) => {
      if (applyAck(res)) setSelectedCardId(null);
    });
  };

  const doTrade = () => {
    if (!selectedCardId) return setError('제안할 카드를 선택하세요.');
    if (!tradeTarget) return setError('거래 상대를 선택하세요.');
    getSocket().emit('proposeTrade', { toId: tradeTarget, offerCardId: selectedCardId }, (res) =>
      applyAck(res)
    );
  };

  const doSyringe = () => {
    if (syringeMode === 'discard') {
      getSocket().emit('useSyringe', { mode: 'discard' }, (res) => applyAck(res));
    } else {
      if (!stealTarget) return setError('훔칠 대상을 선택하세요.');
      getSocket().emit(
        'useSyringe',
        { mode: 'steal', targetPlayerId: stealTarget },
        (res) => applyAck(res)
      );
    }
  };

  const doAdminister = () => {
    if (!window.confirm(`공식 ${adminFormula}로 해독제를 투여할까요? 게임이 종료됩니다.`)) return;
    getSocket().emit('administer', { formulaId: adminFormula }, (res) => applyAck(res));
  };

  const acceptTrade = () => {
    if (!tradeResponseCard) return setError('내줄 카드를 선택하세요.');
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

  const leaveBar = state ? (
    <button type="button" className="ghost leave" onClick={leaveRoom}>
      방 나가기
    </button>
  ) : null;

  // —— Landing ——
  if (!state) {
    return (
      <div className="app shell">
        <header className="hero">
          <p className="badge">멀티플레이 · 방 코드 · 재접속</p>
          <h1>
            해독제 <span>Antidote</span>
          </h1>
          <p className="sub">
            독이 퍼지는 실험실. 숨겨진 해독제 공식을 추론하고, 게임이 끝날 때 그 공식 카드를 손에
            들고 생존하세요.
          </p>
          <p className={`conn ${connected ? 'ok' : ''}`}>
            {connected ? '서버 연결됨' : '서버 연결 중…'}
            {reconnecting ? ' · 재접속 중' : ''}
          </p>
          {info && <p className="info">{info}</p>}
        </header>

        {session?.sessionToken && (
          <div className="panel resume-panel">
            <h2>이전 세션</h2>
            <p className="muted">
              방 <strong>{session.roomCode || '?'}</strong> 에 다시 들어갈 수 있습니다.
            </p>
            <div className="row">
              <button type="button" className="primary" onClick={tryReconnect} disabled={!connected}>
                재접속
              </button>
              <button type="button" onClick={clearSessionLocal}>
                세션 삭제
              </button>
            </div>
          </div>
        )}

        <div className="panel lobby-panel">
          <label>
            닉네임
            <input
              value={name}
              maxLength={16}
              onChange={(e) => saveName(e.target.value)}
              placeholder="표시 이름"
            />
          </label>

          <div className="row">
            <button type="button" className="primary" onClick={createRoom} disabled={!connected}>
              방 만들기
            </button>
          </div>

          <div className="divider">또는 입장</div>

          <label>
            방 코드
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="예: AB3K"
              maxLength={6}
            />
          </label>
          <button type="button" onClick={joinRoom} disabled={!connected}>
            입장하기
          </button>

          {error && <p className="error">{error}</p>}
        </div>

        <section className="howto panel">
          <h2>간단한 규칙</h2>
          <ol>
            <li>7개 공식 중 하나가 진짜 해독제입니다. (서버만 알고 있음)</li>
            <li>
              손에 <strong>X 카드</strong>가 있으면 그 공식은 해독제가 <em>아닙니다</em>.
            </li>
            <li>
              턴마다: <strong>버리기</strong> · <strong>거래</strong> · <strong>주사기</strong> ·
              확신이 있으면 <strong>해독제 투여(종료)</strong>
            </li>
            <li>종료 시 진짜 해독제 공식 카드(숫자 또는 X)를 가진 사람이 생존합니다.</li>
            <li>새로고침해도 같은 브라우저면 세션으로 재접속됩니다.</li>
          </ol>
          <p className="fine">학습용 규칙 구현 · 원작 Bellwether Games Antidote</p>
        </section>
      </div>
    );
  }

  // —— Lobby ——
  if (state.status === 'lobby') {
    const iAmHost = state.hostId === state.me;
    return (
      <div className="app shell">
        <header className="topbar">
          <h1>대기실</h1>
          <div className="code-chip">
            방 코드 <strong>{state.code}</strong>
            <button
              type="button"
              className="ghost"
              onClick={() => navigator.clipboard?.writeText(state.code)}
            >
              복사
            </button>
          </div>
          {leaveBar}
        </header>

        <div className="panel">
          <h2>플레이어 ({state.players.length}/6)</h2>
          <ul className="player-list">
            {state.players.map((p) => (
              <li key={p.id}>
                {p.name}
                {p.isHost ? ' · 호스트' : ''}
                {p.isMe ? ' (나)' : ''}
                {!p.connected ? ' · 오프라인' : ''}
              </li>
            ))}
          </ul>
          {iAmHost ? (
            <button
              type="button"
              className="primary"
              onClick={startGame}
              disabled={state.players.filter((p) => p.connected).length < 2}
            >
              게임 시작 (접속 2명 이상)
            </button>
          ) : (
            <p className="muted">호스트가 시작하기를 기다리는 중…</p>
          )}
          {error && <p className="error">{error}</p>}
          {info && <p className="info">{info}</p>}
        </div>

        <div className="log panel">
          <h3>로그</h3>
          <ul>
            {(state.log || []).map((l, i) => (
              <li key={i}>{l.message}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // —— Ended ——
  if (state.status === 'ended') {
    const iWon = (state.winners || []).includes(state.me);
    return (
      <div className="app shell">
        <header className="hero end">
          <h1>{iWon ? '생존!' : '실험 종료'}</h1>
          <p>
            진짜 해독제 공식:{' '}
            <strong style={formulaStyle(state.formulas, state.antidoteFormulaId)}>
              {' '}
              {state.antidoteFormulaId}{' '}
            </strong>
          </p>
          <p>생존자: {state.winnerNames?.length ? state.winnerNames.join(', ') : '없음'}</p>
        </header>
        <div className="panel">
          <h2>모든 손패 공개</h2>
          {state.players.map((p) => (
            <div key={p.id} className="reveal-block">
              <h3>
                {p.name}
                {(state.winners || []).includes(p.id) ? ' ✓' : ''}
              </h3>
              <div className="hand">
                {(state.allHands?.[p.id] || []).map((c) => (
                  <CardView key={c.id} card={c} formulas={state.formulas} />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="primary"
            onClick={() => {
              leaveRoom();
            }}
          >
            로비로 나가기
          </button>
        </div>
        <div className="log panel">
          <ul>
            {(state.log || []).map((l, i) => (
              <li key={i}>{l.message}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // —— Playing ——
  const turnName = state.players.find((p) => p.id === state.turnPlayerId)?.name || '?';

  return (
    <div className="app shell playing">
      <header className="topbar">
        <div>
          <span className="code-mini">{state.code}</span>
          <h1>해독제</h1>
        </div>
        <div className="topbar-right">
          <div className={`turn-pill ${state.isMyTurn ? 'mine' : ''}`}>
            {state.isMyTurn ? '내 턴' : `${turnName} 님의 턴`}
          </div>
          {leaveBar}
        </div>
      </header>

      {!connected && <p className="error banner">오프라인 — 재연결 중… 손패는 서버에 보존됩니다.</p>}
      {error && <p className="error banner">{error}</p>}
      {info && <p className="info banner">{info}</p>}

      {state.pendingTrade?.amTarget && (
        <div className="panel trade-modal">
          <h2>거래 제안</h2>
          <p>
            {state.pendingTrade.fromName}님이 교환을 제안했습니다.
            {state.pendingTrade.offerCard && (
              <>
                {' '}
                제안 카드: <strong>{state.pendingTrade.offerCard.label}</strong>
              </>
            )}
          </p>
          <p>내줄 카드를 고른 뒤 수락하세요.</p>
          <div className="hand">
            {state.myHand.map((c) => (
              <CardView
                key={c.id}
                card={c}
                formulas={state.formulas}
                selected={tradeResponseCard === c.id}
                onClick={() => setTradeResponseCard(c.id)}
              />
            ))}
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={acceptTrade}>
              수락
            </button>
            <button type="button" onClick={rejectTrade}>
              거절
            </button>
          </div>
        </div>
      )}

      {state.pendingTrade?.amProposer && (
        <div className="panel">
          <p>{state.pendingTrade.toName}님의 응답 대기 중…</p>
          <button type="button" onClick={cancelTrade}>
            제안 취소
          </button>
        </div>
      )}

      <section className="panel">
        <h2>플레이어</h2>
        <ul className="player-list compact">
          {state.players.map((p) => (
            <li key={p.id} className={p.id === state.turnPlayerId ? 'active-turn' : ''}>
              {p.name} · {p.handCount}장
              {p.isMe ? ' (나)' : ''}
              {!p.connected ? ' · 오프라인' : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>버린 카드 ({state.discardPile.length})</h2>
        <div className="hand wrap">
          {state.discardPile.length === 0 && <p className="muted">없음</p>}
          {state.discardPile.map((c) => (
            <CardView key={c.id + c.label} card={c} formulas={state.formulas} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>내 손패</h2>
        {state.eliminatedFormulas?.length > 0 && (
          <p className="hint">
            손에 있는 X로 제외된 공식: {state.eliminatedFormulas.join(', ')} (해독제 아님)
          </p>
        )}
        <div className="hand">
          {state.myHand.map((c) => (
            <CardView
              key={c.id}
              card={c}
              formulas={state.formulas}
              selected={selectedCardId === c.id}
              onClick={
                state.isMyTurn && !state.pendingTrade
                  ? () => setSelectedCardId(c.id)
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {state.isMyTurn && !state.pendingTrade && (
        <section className="panel actions">
          <h2>행동</h2>
          <div className="tabs">
            {[
              ['discard', '버리기'],
              ['trade', '거래'],
              ['syringe', '주사기'],
              ['administer', '해독제 투여'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={action === id ? 'tab on' : 'tab'}
                onClick={() => setAction(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {action === 'discard' && (
            <div>
              <p className="muted">카드를 선택한 뒤 버립니다. (공개 더미로 감)</p>
              <button type="button" className="primary" onClick={doDiscard}>
                선택한 카드 버리기
              </button>
            </div>
          )}

          {action === 'trade' && (
            <div>
              <p className="muted">내가 줄 카드를 고르고 상대를 선택합니다.</p>
              <label>
                상대
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
              <button type="button" className="primary" onClick={doTrade}>
                거래 제안
              </button>
            </div>
          )}

          {action === 'syringe' && (
            <div>
              <p className="muted">손의 주사기를 사용합니다.</p>
              <div className="tabs">
                <button
                  type="button"
                  className={syringeMode === 'discard' ? 'tab on' : 'tab'}
                  onClick={() => setSyringeMode('discard')}
                >
                  버린 카드 가져오기
                </button>
                <button
                  type="button"
                  className={syringeMode === 'steal' ? 'tab on' : 'tab'}
                  onClick={() => setSyringeMode('steal')}
                >
                  상대 손패 훔치기
                </button>
              </div>
              {syringeMode === 'steal' && (
                <label>
                  대상
                  <select value={stealTarget} onChange={(e) => setStealTarget(e.target.value)}>
                    <option value="">선택…</option>
                    {others.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="primary" onClick={doSyringe}>
                주사기 사용
              </button>
            </div>
          )}

          {action === 'administer' && (
            <div>
              <p className="muted">
                확신이 들 때 투여하세요. 게임이 끝나고, <strong>진짜</strong> 해독제 공식 카드를
                가진 사람이 생존합니다.
              </p>
              <label>
                내가 믿는 공식
                <select value={adminFormula} onChange={(e) => setAdminFormula(e.target.value)}>
                  {(state.formulas || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="danger" onClick={doAdminister}>
                해독제 투여 (게임 종료)
              </button>
            </div>
          )}
        </section>
      )}

      <section className="log panel">
        <h3>이벤트</h3>
        <ul>
          {(state.log || [])
            .slice()
            .reverse()
            .map((l, i) => (
              <li key={i}>{l.message}</li>
            ))}
        </ul>
      </section>
    </div>
  );
}
