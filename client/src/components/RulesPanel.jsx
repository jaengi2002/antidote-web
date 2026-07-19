export function RulesPanel({ compact = false }) {
  return (
    <div className={`rules ${compact ? 'rules--compact' : ''}`}>
      <h2>본작 규칙 요약 (Antidote)</h2>
      <ol className="rules__steps">
        <li>
          <strong>비밀 해독제</strong>
          <span>
            7장의 X 중 1장이 상자(봉인)에 들어갑니다. 끝날 때까지 아무도 보지 않습니다.
          </span>
        </li>
        <li>
          <strong>목표</strong>
          <span>
            손패가 줄어들다 <em>마지막 한 장</em>이 진짜 해독제 공식이 되게 만드세요. 점수 = 그
            숫자(틀리면 마이너스).
          </span>
        </li>
        <li>
          <strong>버리기</strong>
          <span>
            턴 주인공이 선언하면 <strong>전원</strong>이 동시에 손에서 1장을 각자{' '}
            <strong>워크스테이션</strong>에 버립니다. 숫자·주사기는 앞면, <strong>X는 뒷면</strong>.
            겹치지 않게 모두 보이게.
          </span>
        </li>
        <li>
          <strong>연구 거래</strong>
          <span>
            (A) 전원 왼쪽/오른쪽으로 카드 1장 패스, 또는 (B) 다른 한 명과 1:1 교환. 거래가 안 되면
            턴을 유지하고 다른 행동을 고릅니다.
          </span>
        </li>
        <li>
          <strong>주사기</strong>
          <span>
            손의 주사기를 써서 상대 <strong>손패(랜덤)</strong> 또는{' '}
            <strong>워크스테이션(선택)</strong>에서 1장을 가져옵니다. 주사기는 상대 워크스테이션에
            앞면으로 남습니다.
          </span>
        </li>
        <li>
          <strong>기억</strong>
          <span>후보 정리·자동 배제 UI는 없습니다. 본 것만으로 추론하세요.</span>
        </li>
      </ol>
      <p className="rules__note">
        Bellwether Games · Dennis Hoyle <em>Antidote</em> 룰북(2–6인, Table 1 덱 구성)에 맞춘
        학습용 구현입니다. 아트·명칭은 자체 테마입니다.
      </p>
    </div>
  );
}
