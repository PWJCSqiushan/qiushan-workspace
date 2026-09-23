param([ValidateSet('Start','Install','Pause','Resume','Stop','Status')][string]$Action='Start')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtimeRoot=Join-Path $env:LOCALAPPDATA 'QiushanWorkspace\garmin-cn'
$pythonPath=Join-Path $taskRoot 'work\garmin-runtime\Scripts\python.exe'
$syncScript=Join-Path $PSScriptRoot 'sync.py'
$pidPath=Join-Path $runtimeRoot 'watch.pid'
$pausePath=Join-Path $runtimeRoot 'paused'
$startupLink=Join-Path ([Environment]::GetFolderPath('Startup')) '丘山 Garmin 睡眠同步.lnk'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
function Get-OwnedProcess {
 if(Test-Path -LiteralPath $pidPath){
  $watchId=0
  if([int]::TryParse((Get-Content -Raw -LiteralPath $pidPath).Trim(),[ref]$watchId)){
   $running=Get-CimInstance Win32_Process -Filter ("ProcessId="+$watchId)
   if($running -and $running.ExecutablePath -eq $pythonPath -and $running.CommandLine.Contains($syncScript)){return $running}
  }
 }
 return $null
}
if($Action -eq 'Status'){
 if(Test-Path -LiteralPath (Join-Path $runtimeRoot 'sync-status.json')){Get-Content -LiteralPath (Join-Path $runtimeRoot 'sync-status.json')}
 Write-Output ("登录启动已安装："+(Test-Path -LiteralPath $startupLink))
 exit
}
if($Action -eq 'Pause'){Set-Content -LiteralPath $pausePath -Value 'Paused by user';Write-Output '已暂停；当前正在进行的只读请求结束后停止下一轮。';exit}
if($Action -eq 'Stop'){
 $running=Get-OwnedProcess
 if($running){Stop-Process -Id $running.ProcessId}
 Set-Content -LiteralPath $pausePath -Value 'Stopped by user'
 Write-Output '已停止并保持暂停；登录启动不会恢复同步，需手动 Resume。'
 exit
}
if($Action -eq 'Resume' -and (Test-Path -LiteralPath $pausePath)){
 Move-Item -LiteralPath $pausePath -Destination (Join-Path $runtimeRoot ('pause-history-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')))
}
if($Action -eq 'Install'){
 $shell=New-Object -ComObject WScript.Shell
 $shortcut=$shell.CreateShortcut($startupLink)
 $shortcut.TargetPath=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
 $shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Action Start'
 $shortcut.WorkingDirectory=$taskRoot
 $shortcut.WindowStyle=7
 $shortcut.Description='丘山时间看板 Garmin 中国区只读睡眠同步；状态与凭证只在本机保存'
 $shortcut.Save()
}
if(!(Test-Path -LiteralPath $pythonPath)){throw '缺少本地 Python 虚拟环境'}
if(!(Test-Path -LiteralPath (Join-Path $runtimeRoot 'config.json'))){throw '请先配置本机限权连接'}
if(Get-OwnedProcess){Write-Output '同步器已运行';exit}
$watchProcess=Start-Process -FilePath $pythonPath -ArgumentList @(('"' + $syncScript + '"'),'--sync','--watch','30') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'watch.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'watch.err.log') -PassThru
Set-Content -LiteralPath $pidPath -Value $watchProcess.Id
Write-Output '本机隐藏同步器已启动；每30秒检查排队请求，每30分钟增量复查。'
