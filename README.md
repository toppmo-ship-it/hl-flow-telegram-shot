# 흐름차트 → 텔레그램 자동 발송 (GitHub Actions)

본가 PC가 꺼져 있어도, GitHub 서버가 **5분마다** 흐름차트를 캡처해 텔레그램으로 보냅니다. (공개 저장소 = Actions 무료·무제한)

## 동작
1. 스케줄(5분)마다 워크플로가 뜸 → 한글 글꼴 설치, 캔들 저장본 캐시 복원
2. `shot.mjs`가 `site/`(흐름차트 화면)를 자기 안에서 열고 `/api/flow-fetch`도 로컬에서 처리
3. 헤드리스 크롬으로 캡처 → 텔레그램 **사진 + 원본 PNG 파일**
4. 설정(기간·봉·필터·해상도·굵기 등)은 설정 페이지(`/shot-config.html`)에서 저장 → Supabase `tg_shot_cfg` → 매번 읽음

## 필요한 설정 (저장소 Settings → Secrets and variables → Actions → New repository secret)
| 이름 | 값 |
|---|---|
| `TG_BOT_TOKEN` | 텔레그램 봇 토큰 (`숫자:영문숫자…`) |
| `TG_CHAT_ID` | 텔레그램 채팅 ID |

## 시험
Actions 탭 → telegram-chart → **Run workflow** (`dry=true` 면 캡처만, 텔레그램 전송 없음 / `overrides` 에 `res=pc&vz=200` 처럼 한 번만 덮어쓰기)

## 주의
- 공개 저장소라 코드는 누구나 볼 수 있어요. **비밀값은 코드에 없습니다**(텔레그램 토큰은 Secrets에만).
- 60일 동안 저장소에 아무 활동이 없으면 GitHub가 스케줄을 자동으로 꺼요 → Actions 탭에서 다시 켜거나 아무 커밋을 하면 됩니다.
- 사이트(흐름차트) 코드를 고쳤다면 `tools/sync-site.ps1` 로 `site/`를 갱신하고 푸시하세요.

## 흐름차트 미리 갱신 (warm.yml)
20분마다 `warm.mjs`가 `site/`의 흐름차트를 `?warm=1`로 대신 열어, 서버 저장본(프레임 스냅샷·일봉 켈트너·4h 중심선·3일 거래대금)을 최신으로 유지합니다. 며칠 만에 사이트를 열어도 바로 최신으로 보이게 하는 용도예요. 설정은 건드리지 않고(저장 끔), 마지막에 쓴 기간/봉으로 엽니다. 시험: Actions 탭 → flow-warm → Run workflow.

## 하이퍼 리포트 (사진) — 탬퍼몽키 3분 리포트와 같은 구성
`shot.mjs` 가 매 실행마다(설정의 주기 `repEvery`에 맞춰) `report.mjs` 로 리포트를 만들어 텔레그램에 사진 + 원본 PNG 로 보냅니다.
- `repcalc.mjs` : 파인스크리너 지표(양W 14/48 · 일봉 켈트너 20/10/1.5 · 켈유 · 4H 켈트너 40/10/2.5 발산 · 스퀴즈 · RV구간 · 듀얼 · VWAP · 3격/5격 · 누적T)를 하이퍼리퀴드 캔들로 계산. 캔들은 `.cache/rep_bars.json.gz` 에 쌓고 새 봉이 생길 때만 이어받음(HL 호출 최소). 처음에는 몇 번 나눠서 모음(첫 리포트까지 15~20분).
- `report.mjs` : 섹션(★핵심 · 지수·원자재 · 전종목 · TOP5 4종 · 최근 진입 · 급변동 · 요약 칩) 조립 + 진입 상태(`.cache/rep_state.json`) 비교
- `rep-render.js` : 헤드리스 크롬 안에서 표를 그림(이모지 대신 벡터 아이콘 — 서버 글꼴과 무관). 가로 폭은 해상도 프리셋(폴드 접힘 1360 · 펼침 2184 · PC 3200)
- `repnames.mjs` : 한글 이름·섹터 사전
- 설정(`tg_shot_cfg`): `rep`(켬/끔) · `repEvery`(분) · `repOrder`/`repOff`(항목 순서·끔) · `repCols`(표 칸) · `repRows` · `repSurge`, 그리고 가격흐름 사진 주기 `flowEvery`
- 시험(전송 없음): `SHOT_DRY=1 SB_OFF=1 REP_LIMIT=30 HL_BUDGET=600 SHOT_SAVE_REPORT=out.png node shot.mjs`

## 「지금 보내기」 (설정 페이지)
설정 페이지의 「📤 지금 보내기」는 설정을 저장한 뒤 Supabase `hlgrid_settings` 의 `tg_shot_cmd`({id, at}) 에 요청을 남깁니다. 사슬의 대기 단계(`waitnext.mjs`)가 8초마다 이 요청을 확인해 새 요청이면 바로 다음 실행을 시작하고, `shot.mjs` 가 주기를 무시(force)하고 설정된 사진·글을 모두 보낸 뒤 모든 `last*` 와 `.cache/anchor.json`(5분 격자 기준)을 누른 시각으로 바꿉니다 → 그 시각부터 주기가 새로 시작. 처리한 요청 id 는 `state.json` 의 `lastCmd`.

## 종목 카드의 일봉 미니차트
카드 사진 왼쪽 아래에 일봉 N개(30/60/90) 차트를 겹쳐 붙임(`site/card.html` 의 `#mini`, 같은 `chartlib.js` 를 `iv:"1d"`·`compact:true`·`rightPad:6` 로 한 번 더 그림). 패턴·패턴 글자는 항상 끔. 설정(`tg_shot_cfg`): `cardDaily`(기본 켬) · `cardDailySize`(s/m/l) · `cardDailyBars` · `cardDailyInd`(kel·vwap·vol·rsi). 일봉 데이터는 카드가 이미 받는 일봉 220개를 재사용(HL 추가 호출 없음). 아래 지표 칩이 채워진 뒤 위치를 잡고, 메인 차트의 패널 제목이 미니에 걸치면 숨김.

## 텔레그램 챗봇 (chat.yml · chatbot.mjs)

방(TG_CHAT_ID)에 글을 쓰면 읽고 답하는 상시 봇. `chat.yml` 이 5시간 40분씩 이어달리며(워치독 cron 15분), 글이 오면 바로 처리합니다.
- **차트**: 종목 이름·티커·줄임말 → 카드(기본 봉·기간은 설정 페이지 값, 글에 봉·기간을 쓰면 그때만 변경)
- **섹터·테마**: 섹터 이름 → 표 한 장(`리포트` 표 칸 설정 따름), 뒤에 `카드` → 카드, `섹터` → 목록(버튼), `테마추가/삭제` → 내 테마
- **조회**: 시세·지표·핵심·발산·켈유·거래대금·등락·급등·진입·매크로·환율·펀딩·OI순위
- **보내기**: 리포트·흐름(`shot.mjs` 를 SHOT_ONLY=flow 로 실행)·카드·순위, `지금` = 사슬에 '지금 보내기' 요청(tg_shot_cmd)
- **설정**: 주기·해상도·미니차트·기본봉/기간·카드 종목·조용히(tg_bot_mute, 사슬이 읽고 쉼) — 모두 Supabase `tg_shot_cfg` 를 읽고-고치고-씀(설정 페이지와 같은 값)
- 구조: 말 해석 `chatparse.mjs`(순수 함수) · 글 꾸미기/도움말 `chatfmt.mjs` · 본체 `chatbot.mjs` · 캔들은 메모리에 계속 최신으로 유지(백그라운드)
- 보안: 설정된 방(TG_CHAT_ID) 글만 처리. 처리한 update 번호는 `tg_bot_offset` 에 저장(재시작해도 중복 처리 없음)
- 시험: `BOT_DRY=1 BOT_INPUT=in.txt node chatbot.mjs` (줄마다 한 글, `@h:chart` 처럼 `@` 로 시작하면 버튼) — 전송·저장 없이 화면 출력 + `out_chat/*.png`
- **알림**(chatalert.mjs): `알림 메타 700` · `알림 메타 +3%` · `알림목록` · `알림삭제` · `진입알림 켜기/전체/끄기` · `급변동알림 3% 30분` — tg_bot_alerts, 가격은 30초·진입/급변동은 5분마다 감시
