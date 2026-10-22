$ErrorActionPreference='Stop'
$workspace='C:\Users\jodyf\Documents\Codex\2026-09-03\som'
$data=Join-Path $workspace 'cy-associative-rehearsal-db-public-gist-v2'
$env:TEMP=Join-Path $workspace 'journal-continuation-test-temp';$env:TMP=$env:TEMP
if(Test-Path -LiteralPath $data){throw 'Refusing to reuse a database directory'}
$bin='C:\wamp\bin\mariadb\mariadb10.10.2\bin'
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
& "$bin\mariadb-install-db.exe" "--datadir=$data" "--port=$port" --silent
if($LASTEXITCODE -ne 0){throw 'Disposable database initialization failed'}
$dbProcess=$null
try {
 $dbProcess=Start-Process -FilePath "$bin\mariadbd.exe" -ArgumentList @('--no-defaults',"--datadir=$data","--port=$port",'--bind-address=127.0.0.1','--innodb-buffer-pool-size=64M','--max-connections=12',"--pid-file=$data\owned.pid",'--skip-log-bin','--skip-name-resolve',"--log-error=$data\owned.err") -WindowStyle Hidden -PassThru
 $ready=$false
 for($i=0;$i -lt 60;$i++){
  if($dbProcess.HasExited){throw 'Owned database exited'}
  if(Test-Path -LiteralPath "$data\owned.pid"){
   $identity=& "$bin\mariadb.exe" --no-defaults -h 127.0.0.1 -P $port -u root --batch --raw --skip-column-names -e 'SELECT @@datadir' 2>$null
   if($LASTEXITCODE -eq 0){
    $identity=[IO.Path]::GetFullPath(([string]$identity).Replace([char]47,[char]92))
    if(([string]$identity).Replace('/','\').TrimEnd('\') -ne $data){throw 'Database identity mismatch'}
    if([int](Get-Content "$data\owned.pid") -ne $dbProcess.Id){throw 'Database PID mismatch'}
    $ready=$true;break
   }
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$ready){throw 'Owned database not ready'}
 $env:CY_TEST_DB_ISOLATED='1';$env:CY_TEST_DB_PORT=[string]$port
 $env:CY_TEST_MARIADB_BIN="$bin\mariadb.exe";$env:CY_TEST_PHP_BIN='C:\php84\php.exe'
 $env:CY_TEST_DB_DEFAULTS=Join-Path $workspace 'postcard-assoc-client.cnf'
 $env:TEMP=Join-Path $workspace 'journal-continuation-test-temp';$env:TMP=$env:TEMP
 Write-Output "Owned disposable database PID=$($dbProcess.Id) port=$port datadir=$data"
 $env:REHEARSAL_RUN='corrected-public-gist'
 & node C:/Users/jodyf/Documents/Codex/2026-09-03/som/cy-associative-rehearsal-20261022/rehearse.mjs
 if($LASTEXITCODE -ne 0){throw 'Bounded rehearsal failed; inspect evidence before further calls'}
} finally {
 if($dbProcess -and !$dbProcess.HasExited){
  Stop-Process -Id $dbProcess.Id
  $dbProcess.WaitForExit()
 }
 if($dbProcess){Write-Output "Owned database stopped: $($dbProcess.HasExited)"}
}
