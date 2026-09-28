param([ValidateSet('Start','Install','Login','Pause','Resume','Stop','Status')][string]$Action='Start',[string]$BasePython='')
$ErrorActionPreference='Stop'
$runtimeRoot=[IO.Path]::GetFullPath($(if((Split-Path $PSScriptRoot -Leaf) -eq 'garmin-cn'){$PSScriptRoot}else{Join-Path $env:LOCALAPPDATA 'QiushanWorkspace\garmin-cn'}))
$probePython=Join-Path $runtimeRoot 'runtime\Scripts\python.exe'
if(Test-Path -LiteralPath $probePython){
 $physicalRoot=& $probePython -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' $runtimeRoot
 if($LASTEXITCODE -ne 0){throw '无法解析实际安装路径'}
 $runtimeRoot=$physicalRoot.Trim()
}
$pythonPath=Join-Path $runtimeRoot 'runtime\Scripts\python.exe'
$pythonWindow=Join-Path $runtimeRoot 'runtime\Scripts\pythonw.exe'
$syncScript=Join-Path $runtimeRoot 'sync.py'
$pidPath=Join-Path $runtimeRoot 'watch.pid'
$pausePath=Join-Path $runtimeRoot 'paused'
$startupLink=Join-Path ([Environment]::GetFolderPath('Startup')) '丘山 Garmin 睡眠同步.lnk'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
if((Get-Item -LiteralPath $runtimeRoot).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '拒绝安装到链接目录'}
function Get-OwnedProcess {
 if(Test-Path -LiteralPath $pidPath){
  $watchId=0
  if([int]::TryParse((Get-Content -Raw -LiteralPath $pidPath).Trim(),[ref]$watchId)){
   $running=Get-CimInstance Win32_Process -Filter ("ProcessId="+$watchId)
   if($running -and $running.ExecutablePath -in @($pythonPath,$pythonWindow) -and $running.CommandLine -and $running.CommandLine.Contains($syncScript)){return $running}
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
 $versionRoot=Join-Path $runtimeRoot ('versions\'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
 if(Test-Path -LiteralPath $startupLink){New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null;Copy-Item -LiteralPath $startupLink -Destination (Join-Path $versionRoot 'previous-startup.lnk')}
 if($BasePython -eq ''){
  $candidate=Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'
  if(Test-Path -LiteralPath $candidate){$BasePython=$candidate}else{$BasePython=(Get-Command python -ErrorAction Stop).Source}
 }
 & $BasePython -c 'import sys; assert sys.version_info >= (3,12)'
 if($LASTEXITCODE -ne 0){throw '需要 Python 3.12 或更新版本'}
 if(!(Test-Path -LiteralPath $pythonPath)){
  & $BasePython -m venv (Join-Path $runtimeRoot 'runtime')
  if($LASTEXITCODE -ne 0){throw '无法建立固定本机运行环境'}
 }
 # Packaged desktop apps may virtualize LocalAppData. Startup must use physical paths.
 $physicalRoot=& $pythonPath -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' $runtimeRoot
 if($LASTEXITCODE -ne 0){throw '无法解析实际安装路径'}
 $runtimeRoot=$physicalRoot.Trim()
 $pythonPath=Join-Path $runtimeRoot 'runtime\Scripts\python.exe'
 $pythonWindow=Join-Path $runtimeRoot 'runtime\Scripts\pythonw.exe'
 $syncScript=Join-Path $runtimeRoot 'sync.py'
 $configPath=Join-Path $runtimeRoot 'config.json'
 if(Test-Path -LiteralPath $configPath){
  $existingConfig=Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  if($existingConfig.tokenStore){
   $physicalTokens=& $pythonPath -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' $existingConfig.tokenStore
   if($LASTEXITCODE -ne 0){throw '无法解析已有会话路径'}
   if($physicalTokens.Trim() -ne $existingConfig.tokenStore){
    New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $versionRoot 'config.before-path-update.json')
    $existingConfig.tokenStore=$physicalTokens.Trim()
    $existingConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding utf8
   }
  }
 }
 & $pythonPath -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements.txt')
 if($LASTEXITCODE -ne 0){throw '安装 Garmin 依赖失败'}
 & $pythonPath -c 'import tkinter,garminconnect'
 if($LASTEXITCODE -ne 0){throw '缺少登录窗口或 Garmin 依赖'}
 $sourceDir=[IO.Path]::GetFullPath($PSScriptRoot)
 if($sourceDir -ne $runtimeRoot){
  foreach($name in @('sync.py','login_ui.py','start-hidden.ps1','requirements.txt','README.md')){
   $destination=Join-Path $runtimeRoot $name
   if(Test-Path -LiteralPath $destination){New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null;Copy-Item -LiteralPath $destination -Destination (Join-Path $versionRoot $name)}
   Copy-Item -LiteralPath (Join-Path $sourceDir $name) -Destination $destination -Force
  }
 }
 $shell=New-Object -ComObject WScript.Shell
 $shortcut=$shell.CreateShortcut($startupLink)
 $shortcut.TargetPath=$pythonWindow
 $shortcut.Arguments='"'+$syncScript+'" --sync --watch 30'
 $shortcut.WorkingDirectory=$runtimeRoot
 $shortcut.WindowStyle=7
 $shortcut.Description='丘山时间看板 Garmin 中国区只读睡眠同步；状态与凭证只在本机保存'
 $shortcut.Save()
 $loginShortcut=$shell.CreateShortcut((Join-Path $runtimeRoot 'Garmin 登录.lnk'))
 $loginShortcut.TargetPath=$pythonWindow
 $loginShortcut.Arguments='"'+(Join-Path $runtimeRoot 'login_ui.py')+'"'
 $loginShortcut.WorkingDirectory=$runtimeRoot
 $loginShortcut.Description='在本机登录或重新验证 Garmin 中国区'
 $loginShortcut.Save()
 Write-Output '已安装到固定目录并配置 Windows 登录后启动。已有配置、会话和待提交记录保留。'
 exit
}
if(!(Test-Path -LiteralPath $pythonPath)){throw '请先执行 Install 安装固定本机运行环境'}
if($Action -eq 'Login'){
 Start-Process -FilePath $pythonWindow -ArgumentList ('"'+(Join-Path $runtimeRoot 'login_ui.py')+'"') -WorkingDirectory $runtimeRoot -WindowStyle Hidden
 Write-Output '已打开本机 Garmin 登录窗口。'
 exit
}
if(!(Test-Path -LiteralPath (Join-Path $runtimeRoot 'config.json'))){throw '请先配置本机限权连接'}
if(Get-OwnedProcess){Write-Output '同步器已运行';exit}
$watchProcess=Start-Process -FilePath $pythonPath -ArgumentList @(('"' + $syncScript + '"'),'--sync','--watch','30') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'watch.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'watch.err.log') -PassThru
Set-Content -LiteralPath $pidPath -Value $watchProcess.Id
Write-Output '本机隐藏同步器已启动；每30秒检查排队请求，每30分钟增量复查。'
