export function RulesPanel({ compact = false }) {
  return (
    <div className={`rules ${compact ? 'rules--compact' : ''}`}>
      <h2>해독제 규칙 (번역 룰북)</h2>
      <ol className="rules__steps">
        <li>
          <strong>목표</strong>
          <span>
            게임이 끝났을 때, <em>해독제와 같은 제조법</em>의 카드를 마지막 한 장으로 가지고
            있어야 합니다. 맞으면 그 숫자만큼 점수, 틀리면 그 숫자만큼 감점, 주사기면 −1.
          </span>
        </li>
        <li>
          <strong>세팅 (표1)</strong>
          <span>
            X 중 1장 봉인. 남은 X+주사기를 시드로 나눠 준 뒤 숫자 카드를 나눠 시작 손 크기를
            맞춥니다. 2–6인 7제조법, 7인 8제조법(Agent-U). 2인은 3인 구성 +{' '}
            <em>투명 플레이어</em>.
          </span>
        </li>
        <li>
          <strong>1. 카드 버리기</strong>
          <span>
            전원 동시에 손의 1장을 각자 워크스테이션에. 일반 카드 앞면, <strong>X는 뒷면</strong>.
            2인 시 투명 플레이어는 버리지 않음.
          </span>
        </li>
        <li>
          <strong>2. 연구 거래</strong>
          <span>
            (A) 전원 왼/오른쪽으로 1장 패스 (투명도 참여) · (B) 1:1 교환 (투명과 불가). 거래
            상대가 없으면 다른 행동.
          </span>
        </li>
        <li>
          <strong>3. 주사기</strong>
          <span>
            상대 손(랜덤) 또는 워크스테이션(선택)에서 1장. 훔친 자리에 주사기를 놓음 (WS는
            앞면, 투명 손이면 뒷면).
          </span>
        </li>
        <li>
          <strong>타임 아웃</strong>
          <span>손패가 마지막 한 장이 되면 종료. 봉인 X 공개 후 점수. (시리즈 3판은 선택)</span>
        </li>
      </ol>
      <p className="rules__note">
        기준: <em>Antidote_번역.pdf</em> 기본 규칙. 플라시보·연구소 로맨스 확장은 아직 미구현.
        자동으로 후보를 정리해 주지 않습니다 — 기억과 추론이 핵심입니다.
      </p>
    </div>
  );
}
