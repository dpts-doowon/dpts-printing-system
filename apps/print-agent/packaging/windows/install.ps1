<#
  Instala o Print Agent como tarefa agendada (inicia com o Windows, reinicia após falha).
  PROVISÓRIO: o formato final de instalação depende do sistema operacional e das políticas dos PCs (a definir com a Doowon).
  Requer: PowerShell como Administrador e Node.js 22 instalado.
  Uso:  .\install.ps1 -InstallDir C:\DoowonPrintAgent
#>
param([string]$InstallDir = "C:\DoowonPrintAgent")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js 22 não encontrado. Instale o Node.js 22 (LTS) antes de continuar." }
if ([int]((& $node -p "process.versions.node.split('.')[0]")) -lt 22) { throw "É necessário o Node.js 22 ou superior." }

New-Item -ItemType Directory -Force -Path $InstallDir, "$InstallDir\data", "$InstallDir\logs" | Out-Null
Copy-Item "$root\doowon-print-agent.mjs" "$InstallDir\doowon-print-agent.mjs" -Force
if (-not (Test-Path "$InstallDir\agent.config.json")) {
  Copy-Item "$root\agent.config.example.json" "$InstallDir\agent.config.json"
  Write-Host "Edite $InstallDir\agent.config.json e grave o token do agente em $InstallDir\agent.token"
}

# Somente Administradores e SYSTEM podem ler o token e gravar o journal.
icacls $InstallDir /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null

& $node "$InstallDir\doowon-print-agent.mjs" --config "$InstallDir\agent.config.json" --check
if ($LASTEXITCODE -ne 0) { Write-Warning "Configuração incompleta: ajuste o arquivo e execute novamente para registrar a tarefa."; exit 1 }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$InstallDir\doowon-print-agent.mjs`" --config `"$InstallDir\agent.config.json`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName "DoowonPrintAgent" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "DoowonPrintAgent"
Write-Host "Print Agent instalado e iniciado (tarefa DoowonPrintAgent). Logs em $InstallDir\logs."
