# Waits for the embed backfill to COMPLETE (a fresh "Bitti" line stamped after
# this script started), then restores a default Ollama and launches the 27B
# fit worker. ASCII-only on purpose: this file travels through shells.
Set-Location "C:\Users\hoyti\OneDrive\Desktop\Projects\JobRadar"
$startStamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss")
Write-Output "chain armed at $startStamp (UTC)"
while ($true) {
  Start-Sleep -Seconds 300
  $line = Get-Content "embed-fill.log" -Tail 1 -ErrorAction SilentlyContinue
  if ($null -ne $line -and $line -match "Bitti") {
    $m = [regex]::Match($line, "^\[([0-9T:\-]+)\]")
    if ($m.Success -and $m.Groups[1].Value -gt $startStamp) { break }
  }
}
Write-Output "embed complete: $line"
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
