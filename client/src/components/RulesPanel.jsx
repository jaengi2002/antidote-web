export function RulesPanel({ compact = false }) {
  return (
    <div className={`rules ${compact ? 'rules--compact' : ''}`}>
      <h2>한 판의 흐름</h2>
      <ol className="rules__steps">
        <li>
          <strong>비밀 해독제</strong>
          <span>일곱 독 중 하나의 X가 상자 안에 봉인됩니다. 아무도 모릅니다.</span>
        </li>
        <li>
          <strong>손에 있는 X = 배제</strong>
          <span>그 독은 해독제가 아닙니다. 카드 아래 「제외」 칩으로 표시됩니다.</span>
        </li>
        <li>
          <strong>턴마다 하나</strong>
          <span>
            버리기(공개) · 거래(1:1 교환) · 주사기(버린 카드 집기 / 상대 손 훔치기) · 확신이 있으면
            해독제 투여로 종료
          </span>
        </li>
        <li>
          <strong>생존 조건</strong>
          <span>
            종료 시 <em>진짜</em> 해독제 독의 카드(숫자 또는 X)를 한 장이라도 든 사람이 생존합니다.
          </span>
        </li>
      </ol>
      <p className="rules__note">
        학습용 웹 구현입니다. 원작은 Bellwether Games의 <em>Antidote</em> 보드게임이며, 세부
        규칙은 단순화되어 있을 수 있습니다.
      </p>
    </div>
  );
}
