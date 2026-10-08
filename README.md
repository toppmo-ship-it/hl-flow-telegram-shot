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
