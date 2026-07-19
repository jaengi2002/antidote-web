export function RulesPanel({ compact = false }) {
  return (
    <div className={`rules ${compact ? 'rules--compact' : ''}`}>
      <h2>해독제 — 쉽게 읽는 규칙</h2>
      <ol className="rules__steps">
        <li>
          <strong>목표</strong>
          <span>
            게임이 끝났을 때, <em>진짜 해독제와 같은 약(별명)</em> 카드를 마지막 한 장으로 가지고
            있어야 합니다. 맞으면 그 숫자만큼 점수, 틀리면 그 숫자만큼 감점, 주사라면 −1.
          </span>
        </li>
        <li>
          <strong>세팅</strong>
          <span>
            X 중 1장이 봉인된 해독제입니다. 약은 짧은 별명으로 구분합니다: 해골, 물방울, 이파리,
            위험, 수정, 불꽃, 분자 (7인이면 유령). 2인은 투명 플레이어 포함.
          </span>
        </li>
        <li>
          <strong>1. 카드 버리기</strong>
          <span>
            전원 동시에 손의 1장을 <strong>내 앞</strong>에 둡니다. 일반 카드 앞면,{' '}
            <strong>X·속임수 약</strong>은 뒷면.
          </span>
        </li>
        <li>
          <strong>2. 연구 거래</strong>
          <span>
            (A) 전원 왼/오른쪽으로 1장 패스 · (B) 1:1 교환. 거래가 안 되면 다른 행동.
          </span>
        </li>
        <li>
          <strong>3. 주사</strong>
          <span>
            상대 손(랜덤) 또는 상대 <strong>내 앞</strong>(선택)에서 1장. 훔친 자리에 주사를
            놓습니다.
          </span>
        </li>
        <li>
          <strong>확장</strong>
          <span>
            <em>속임수 약 확장</em>: 속임수 약, 임상 실험, 담당 표. <em>비밀 목표</em>: 개인 목표
            카드 1장(게임당 한 번 뽑기).
          </span>
        </li>
        <li>
          <strong>타임 아웃</strong>
          <span>손패가 마지막 한 장이 되면 종료. 봉인 X 공개 후 점수.</span>
        </li>
      </ol>
      <p className="rules__note">
        룰 구조는 본작 Antidote 번역 룰북을 따릅니다. 화면 용어는 더 친숙한 말로 바꿔 두었습니다.
      </p>
    </div>
  );
}
