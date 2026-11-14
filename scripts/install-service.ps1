<#
  Registers Circuit as a scheduled task so it starts at log-on and stays running.

  Circuit is not just a website you open. Its background worker runs the morning routine,
  syncs competitors' Instagram, renews the Meta token and takes the daily backup - none of
  which happens while the app is closed. Before this, Circuit only ran while a terminal or an
  editor happened to be holding it open, so the backup was only ever as recent as the last
  time somebody started it by hand.

  A scheduled task rather than a Windows service: a service needs an administrator and extra
  tooling, while this needs neither and runs as the person who owns the data.

  Re-running is safe; it replaces the existing task.
  Remove it with:  schtasks /delete /tn Circuit /f
#>
[CmdletBinding()]
param(
  [string]$TaskName = "Circuit",
  [int]$Port = 3210
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node is not on PATH; install Node.js or open a shell where 'node' works." }

$nextBin = Join-Path $root "node_modules\next\dist\bin\next"
if (-not (Test-Path $nextBin)) { throw "Next is not installed in $root - run 'npm install' first." }
if (-not (Test-Path (Join-Path $root ".next\BUILD_ID"))) {
  Write-Host "No production build yet - building..."
  Push-Location $root
  try { & npm run build; if ($LASTEXITCODE -ne 0) { throw "npm run build failed" } } finally { Pop-Location }
}

$who = "$env:USERDOMAIN\$env:USERNAME"

# Task Scheduler reads this as UTF-16; anything else and schtasks rejects it.
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs Circuit (BNC Motors marketing) on http://localhost:$Port, so its background worker keeps doing the morning routine, the competitor sync and the daily backup.</Description>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$who</UserId>
      <Delay>PT20S</Delay>
    </LogonTrigger>
    <!--
      The watchdog, and the reason this task is reliable.

      Task Scheduler's "restart the task if it fails" was tried first and does not work for a
      long-running server: killing Circuit left Last Result -1073741510 and nothing restarted
      it. So instead the task simply tries to start every five minutes forever. While Circuit
      is healthy the attempt is discarded, because MultipleInstancesPolicy below is IgnoreNew;
      if it has died, the next tick brings it back. Self-healing within five minutes, with no
      service wrapper and no extra software.
    -->
    <TimeTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$who</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$node</Command>
      <Arguments>"$nextBin" start -p $Port</Arguments>
      <WorkingDirectory>$root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$tmp = Join-Path $env:TEMP "circuit-task.xml"
[System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)

& schtasks /create /tn $TaskName /xml $tmp /f | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks could not register the task (exit $LASTEXITCODE)" }
Remove-Item $tmp -Force

Write-Host "Registered '$TaskName'"
Write-Host "  runs as      $who, at log-on, hidden, restarted up to 3 times if it falls over"
Write-Host "  command      $node `"$nextBin`" start -p $Port"
Write-Host "  working dir  $root"
Write-Host ""
Write-Host "  start now    schtasks /run /tn $TaskName"
Write-Host "  stop         schtasks /end /tn $TaskName"
Write-Host "  remove       schtasks /delete /tn $TaskName /f"
