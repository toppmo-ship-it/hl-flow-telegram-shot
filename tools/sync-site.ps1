# 사이트(트레이딩/hl-grid-deploy)의 최신 화면·데이터 코드를 이 실행기(site/)로 복사합니다.
# 원칙: 사이트와 공통인 코드는 선구안(hl-grid-deploy)이 원본 — 고친 뒤 이 스크립트로 러너에 맞추고 두 저장소 모두 푸시. card.html(카드 전용)만 러너에서 따로 관리
# 사용: powershell -File tools/sync-site.ps1  → 그 뒤 git add/commit/push
$src = "C:\Users\toppm\트레이딩\hl-grid-deploy"
$dst = Join-Path $PSScriptRoot "..\site"
foreach ($f in "flow.html","flow-data.js","flow-chart.js","flow-ui.js","chartlib.js","patterns.js","quant.js") { Copy-Item "$src\$f" "$dst\$f" -Force }
Copy-Item "$src\vendor\lightweight-charts.js" "$dst\vendor\lightweight-charts.js" -Force
Copy-Item "$src\api\flow-fetch.js" "$dst\api\flow-fetch.js" -Force
Write-Host "site/ 동기화 완료"
node (Join-Path $PSScriptRoot "extract-names.mjs") "$src\index.html" (Join-Path $dst "names-ko.json")
