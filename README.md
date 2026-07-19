# 해독제 (Antidote) — 웹 멀티플레이

Bellwether Games **Antidote** 규칙을 학습용으로 재구현한 **방 코드 멀티플레이** 웹 게임입니다.  
서버가 유일한 권위(해독제·타인 손패 비공개)이며, 배포 시 **Express가 빌드된 클라이언트를 함께 서빙**합니다.

> 비상업·학습 목적. 원작 상표/아트를 사용하지 마세요.

## 스택

- **Client:** Vite + React + socket.io-client  
- **Server:** Node + Express + Socket.IO  
- **배포:** 단일 프로세스 (`PORT` 환경변수) — Railway / Render / Fly / 아무 Node 호스트

## 로컬 실행

```bash
# 의존성
npm run install:all

# 터미널 1 — 서버 (기본 :4000)
npm run dev:server

# 터미널 2 — 클라이언트 (기본 :5173, socket 프록시)
npm run dev:client
```

브라우저에서 http://localhost:5173  
두 개 이상의 브라우저(또는 시크릿 창)로 방 만들기 / 코드 입장을 테스트하세요.

## 프로덕션(배포) 빌드

```bash
npm run install:all
npm run build          # client/dist 생성
npm start              # server가 client/dist 서빙 + Socket.IO
```

환경 변수:

| 변수 | 설명 |
|------|------|
| `PORT` | 서버 포트 (플랫폼이 자동 설정하는 경우 많음) |
| `CORS_ORIGIN` | (선택) 허용 origin 목록, 쉼표 구분. 미설정 시 기본 허용 |
| `VITE_SOCKET_URL` | (선택) 빌드 시 소켓 URL. **같은 origin 배포면 비우기** |

### Railway / Render 예시

1. 이 저장소 루트를 서비스 루트로 연결  
2. **Build command:** `npm run install:all && npm run build`  
3. **Start command:** `npm start`  
4. 공개 URL로 접속 → 방 만들기 → 친구에게 4글자 코드 공유  

Render 등에서 Node 버전 18+ 를 선택하세요.

## 플레이 요약

1. 방 만들기 / 코드로 입장 (2~6명)  
2. 호스트가 시작  
3. 턴: **버리기** · **거래** · **주사기**(버린 카드 회수 또는 상대 랜덤 훔치기)  
4. 확신이 있으면 **해독제 투여** → 종료  
5. **진짜 해독제 공식** 카드(숫자 또는 X)를 가진 사람 생존  

손에 **X**가 있으면 그 공식은 해독제가 아닙니다.

## 프로젝트 구조

```
antidote-web/
  client/          # React UI
  server/
    server.js      # HTTP + Socket.IO + static
    game/
      deck.js      # 덱 구성·셋업
      roomManager.js  # 방·턴·액션·비공개 뷰
```

## 재접속

- 방 입장/생성 시 `sessionToken`이 브라우저 `localStorage`에 저장됩니다.
- 새로고침·일시 끊김 후 자동으로 `reconnectSession`을 호출합니다.
- 로비 오프라인: 약 45초 후 좌석 제거 / 게임 중: 최대 약 30분 좌석 유지.
- **방 나가기**를 누르면 즉시 퇴장·세션 삭제입니다.
- 오프라인 플레이어 턴은 자동으로 건너뜁니다.

## 알려진 제한 (MVP)

- 메모리 룸(서버 재시작 시 방·세션 소멸, Redis 없음)
- 원작의 세부 변형 규칙(동시 버리기 등)은 단순화
- 봇·관전 모드 없음

## GitHub → 배포

```bash
cd antidote-web
git init
git add .
git commit -m "Antidote multiplayer web game"
# GitHub 원격 추가 후 push
# Railway 또는 Render에서 이 저장소 연결 (render.yaml / railway.toml 포함)
```
