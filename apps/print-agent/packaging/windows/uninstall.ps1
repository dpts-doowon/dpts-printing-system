<# Remove a tarefa agendada. Mantém journal, logs e configuração (nunca apague o journal com impressão em andamento). #>
param([string]$InstallDir = "C:\DoowonPrintAgent")
$ErrorActionPreference = "Stop"
Stop-ScheduledTask -TaskName "DoowonPrintAgent" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "DoowonPrintAgent" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Tarefa removida. Os arquivos em $InstallDir foram mantidos."
