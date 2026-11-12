$ErrorActionPreference = 'Stop'
$logRoot = Join-Path $env:LOCALAPPDATA 'DalalaRestaurant\logs'
$logPath = Join-Path $logRoot 'last-error.txt'
$createdNew = $false
$global:DalalaInstanceMutex = [Threading.Mutex]::new($true, 'Local\DalalaRestaurant1', [ref]$createdNew)
if (-not $createdNew) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show('المنظومة تعمل بالفعل على هذا الجهاز. استخدم النافذة المفتوحة.', 'منظومة دلالة للمطاعم والمقاهي', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {}
    exit 0
}
try {
    & (Join-Path $PSScriptRoot 'DalalaRestaurant.ps1')
}
catch {
    $details = $_ | Out-String
    try {
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
        [IO.File]::AppendAllText($logPath, ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] تعذر بدء المنظومة' + [Environment]::NewLine + $details + [Environment]::NewLine), [Text.Encoding]::UTF8)
    } catch {}
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show(('تعذر تشغيل المنظومة.' + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'حُفظت التفاصيل في:' + [Environment]::NewLine + $logPath), 'منظومة دلالة للمطاعم والمقاهي', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } catch { Write-Error $details }
    exit 1
}
