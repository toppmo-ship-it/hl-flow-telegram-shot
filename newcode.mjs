/* 새 코드 감지 — 5시간 40분씩 이어달리는 상시 작업(코인·챗봇)이 옛 체크아웃을 끝까지 붙들지 않도록,
   몇 분마다 저장소 main 의 최신 커밋을 보고 지금 돌고 있는 커밋(GITHUB_SHA)과 다르면 "끝내라"고 알려 줌.
   → 작업이 조용히 종료하면 워크플로의 '이어걸기' 단계가 다음 실행을 걸고, 그 실행은 새 코드를 받음(수 분 안에 반영).
   GitHub 작업 밖(로컬 시험)에서는 환경변수가 없어 항상 false. API 오류도 false(괜히 멈추지 않음). */
const SHA = process.env.GITHUB_SHA || "", REPO = process.env.GITHUB_REPOSITORY || "", TOK = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const EVERY = (+process.env.NEWCODE_EVERY_MIN || 3) * 60000, MIN_RUN = (+process.env.NEWCODE_MIN_RUN_MIN || 5) * 60000;
let lastChk = 0, found = false, t0 = Date.now();

export async function newCodeReady(log) {
  if (found) return true;
  if (!SHA || !REPO || !TOK) return false;
  const now = Date.now();
  if (now - t0 < MIN_RUN || now - lastChk < EVERY) return false;   /* 시작 5분은 안 봄(막 시작한 실행이 바로 끝나는 일 방지), 3분마다 한 번만 */
  lastChk = now;
  try {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 8000);
    const r = await fetch("https://api.github.com/repos/" + REPO + "/commits/" + encodeURIComponent(BRANCH), { headers: { Authorization: "Bearer " + TOK, Accept: "application/vnd.github+json", "User-Agent": "hl-runner" }, signal: ac.signal });
    clearTimeout(tm);
    if (!r.ok) return false;
    const j = await r.json(), head = String((j && j.sha) || "");
    if (head && head !== SHA) { found = true; if (log) log("새 코드 감지:", SHA.slice(0, 7), "→", head.slice(0, 7), "— 이번 실행을 마치고 다음 실행이 새 코드로 이어받음"); return true; }
  } catch (e) {}
  return false;
}
