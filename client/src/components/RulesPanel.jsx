export function RulesPanel({ compact = false }) {
  return (
    <div className={`rules ${compact ? 'rules--compact' : ''}`}>
      <h2>한 판의 흐름</h2>
      <ol className="rules__steps">
        <li>
          <strong>비밀 해독제</strong>
          <span>일곱 독 중 하나의 X가 상자 안에 봉인됩니다. 내용은 끝까지 비밀입니다.</span>
        </li>
        <li>
          <strong>기억과 추론</strong>
          <span>
            무엇이 버려졌는지, 무엇이 아직 후보인지는 <em>스스로</em> 추적합니다. 앱이 후보를
            지워 주거나 정리해 주지 않습니다. (손에 든 X는 그 독이 해독제가 아님을 뜻합니다 —
            규칙은 알지만 표시는 안 합니다.)
          </span>
        </li>
        <li>
          <strong>턴마다 하나</strong>
          <span>
            버리기(공개) · 거래 · 주사기 · 확신이 있으면 해독제 투여로 종료. 공개된 카드는 테이블에
            남지만, 그걸 어떻게 해석할지는 플레이어의 몫입니다.
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
        학습용 웹 구현입니다. 원작은 Bellwether Games의 <em>Antidote</em> 이며, 본작의 묘미인
        「기억·블러핑·추론」을 해치지 않도록 자동 정리 UI는 넣지 않습니다.
      </p>
    </div>
  );
}
