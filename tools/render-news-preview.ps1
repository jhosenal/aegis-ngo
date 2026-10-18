# Rebuild the cached, offline introduction. No Google credentials or paid calls.
$ErrorActionPreference = 'Stop'
$aegisRoot = Split-Path -Parent $PSScriptRoot
Push-Location $aegisRoot
try {
  $aegisIntro = node --import=tsx --input-type=module -e "import { WELCOME } from './ui/src/dashboard/newsContent.ts'; console.log(WELCOME.paragraphs.join(' '));"
  if ($LASTEXITCODE -ne 0) { throw 'Could not load the registered introduction.' }
  Add-Type -AssemblyName System.Speech
  $aegisSpeaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $aegisSpeaker.SelectVoice('Microsoft Zira Desktop')
    $aegisSpeaker.Rate = 0
    $aegisSpeaker.SetOutputToWaveFile((Join-Path $aegisRoot 'ui/public/media/aegis-introduction-v1.wav'))
    $aegisSpeaker.Speak(($aegisIntro -join ' '))
  } finally { $aegisSpeaker.Dispose() }
  Write-Output 'Cached introduction rebuilt with Microsoft Zira Desktop. Run build:ui to serve it.'
} finally { Pop-Location }
