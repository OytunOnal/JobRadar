# Waits for the embed backfill to finish, then restores a default Ollama and
# launches the 27B fit worker. ASCII-only on purpose: this file travels
# through shells.
#
# It reads .run/embed-fill.json, the receipt every backfill writes on its way
# out. It used to tail embed-fill.log for the word "Bitti" and compare an ISO
# timestamp as a STRING, which bound this file to two undeclared contracts:
# the exact fixed-width stamp format, and one Turkish word in a log line.
# Translate that footer or add milliseconds to the stamp and this script waits
# forever. The receipt has neither problem, and it also distinguishes the two
# endings a log line could not: "drained" is finished, "failstreak" is not.
Set-Location "C:\Users\hoyti\OneDrive\Desktop\Projects\JobRadar"
$receipt = ".run\embed-fill.json"
Remove-Item $receipt -ErrorAction SilentlyContinue
Write-Output "chain armed - waiting for a fresh $receipt"

while ($true) {
  Start-Sleep -Seconds 60
  if (-not (Test-Path $receipt)) { continue }
  $run = Get-Content $receipt -Raw | ConvertFrom-Json
  if ($run.stopped -eq "drained" -or $run.stopped -eq "budget") {
    Write-Output "embed complete: $($run.done) embedded, stopped=$($run.stopped)"
    break
  }
  Write-Output "embed stopped early (stopped=$($run.stopped), done=$($run.done)) - not chaining"
  exit 1
}

Write-Output "restarting ollama with default env, then launching 27B fit worker"
Stop-Process -Name "ollama" -Force -Confirm:$false -ErrorAction SilentlyContinue
Stop-Process -Name "llama-server" -Force -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 8
$env:LLM_DISABLE = "anthropic,deepseek,groq,gemini,cerebras,openai"
$env:OLLAMA_MODEL = "qwen3.8:27b"
$env:FIT_SLEEP_MS = "0"
npm run fit:fill -- --wide --wait 30
