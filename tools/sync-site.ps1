# 사이트(트레이딩/hl-grid-deploy)의 최신 화면·데이터 코드를 이 실행기(site/)로 복사합니다.
# 사용: powershell -File tools/sync-site.ps1  → 그 뒤 git add/commit/push
$src = "C:\Users\toppm\트레이딩\hl-grid-deploy"
$dst = Join-Path $PSScriptRoot "..\site"
foreach ($f in "flow.html","flow-data.js","flow-chart.js","flow-ui.js") { Copy-Item "$src\$f" "$dst\$f" -Force }
Copy-Item "$src\vendor\lightweight-charts.js" "$dst\vendor\lightweight-charts.js" -Force
Copy-Item "$src\api\flow-fetch.js" "$dst\api\flow-fetch.js" -Force
Write-Host "site/ 동기화 완료"
