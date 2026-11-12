$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
[Windows.Forms.Application]::EnableVisualStyles()

$global:AppRoot   = $PSScriptRoot
$global:AppTitle  = 'منظومة دلالة للمطاعم والمقاهي'
$global:DataDir   = Join-Path $env:LOCALAPPDATA 'DalalaRestaurant'
$global:LogPath   = Join-Path $global:DataDir 'logs\last-error.txt'
$global:UiPort    = 47631
$global:UiFont    = 'Segoe UI'
$global:Ser       = [Web.Script.Serialization.JavaScriptSerializer]::new()
$global:Ser.MaxJsonLength = [int]::MaxValue
$global:NetSrv = $null; $global:UiSrv = $null; $global:NetErr = ''; $global:LastSaved = ''

function global:Write-AppError([string]$Title, [string]$Details) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $global:LogPath) | Out-Null
        [IO.File]::AppendAllText($global:LogPath, ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Title + [Environment]::NewLine + $Details + [Environment]::NewLine), [Text.Encoding]::UTF8)
    } catch {}
}

# ===================== الحماية: ملفات سليمة + تفعيل مرتبط بالجهاز =====================
function global:Load-Libraries {
    foreach ($n in @('DalalaLicense.dll', 'DalalaCore.dll')) {
        $p = Join-Path $global:AppRoot $n
        if (-not (Test-Path -LiteralPath $p)) { throw ('ملف مفقود: ' + $n + ' — أعد تثبيت المنظومة.') }
        Add-Type -Path $p -ErrorAction Stop
    }
}
function global:Test-LicenseFiles {
    $problem = ''
    $ok = [DalalaRestaurantLicense.Guard]::VerifyFiles($global:AppRoot, [ref]$problem)
    return [PSCustomObject]@{ ok = [bool]$ok; problem = [string]$problem }
}
function global:Show-ActivationDialog {
    $machine = [DalalaRestaurantLicense.Guard]::MachineCode()
    $f = [Windows.Forms.Form]::new()
    $f.Text = 'تفعيل ' + $global:AppTitle; $f.RightToLeft = 'Yes'; $f.RightToLeftLayout = $true
    $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.ClientSize = [Drawing.Size]::new(620, 470); $f.Font = [Drawing.Font]::new($global:UiFont, 10)
    $iconPath = Join-Path $global:AppRoot 'Dalala.ico'; if (Test-Path -LiteralPath $iconPath) { try { $f.Icon = [Drawing.Icon]::new($iconPath) } catch {} }
    $title = [Windows.Forms.Label]::new(); $title.Text = 'هذه النسخة تحتاج إلى تفعيل'; $title.Font = [Drawing.Font]::new($global:UiFont, 15, [Drawing.FontStyle]::Bold)
    $title.ForeColor = [Drawing.Color]::FromArgb(194, 65, 12); $title.SetBounds(20, 14, 580, 36)
    $help = [Windows.Forms.Label]::new(); $help.SetBounds(20, 54, 580, 70)
    $help.Text = '1) أرسل "رمز الجهاز" الظاهر أدناه إلى مزوّد المنظومة.' + [Environment]::NewLine + '2) سيرسل لك "رقم التفعيل" الخاص بهذا الجهاز فقط.' + [Environment]::NewLine + '3) الصقه في الخانة أدناه واضغط "تفعيل".'
    $l1 = [Windows.Forms.Label]::new(); $l1.Text = 'رمز الجهاز'; $l1.SetBounds(20, 134, 200, 24)
    $tm = [Windows.Forms.TextBox]::new(); $tm.ReadOnly = $true; $tm.Text = $machine; $tm.RightToLeft = 'No'; $tm.TextAlign = 'Center'
    $tm.Font = [Drawing.Font]::new('Consolas', 16, [Drawing.FontStyle]::Bold); $tm.SetBounds(20, 160, 440, 36)
    $copy = [Windows.Forms.Button]::new(); $copy.Text = 'نسخ الرمز'; $copy.SetBounds(470, 160, 130, 36)
    $copy.Add_Click({ try { [Windows.Forms.Clipboard]::SetText($tm.Text) } catch {} }.GetNewClosure())
    $l2 = [Windows.Forms.Label]::new(); $l2.Text = 'رقم التفعيل'; $l2.SetBounds(20, 214, 200, 24)
    $ta = [Windows.Forms.TextBox]::new(); $ta.Multiline = $true; $ta.RightToLeft = 'No'; $ta.Font = [Drawing.Font]::new('Consolas', 11); $ta.SetBounds(20, 240, 580, 90)
    $msg = [Windows.Forms.Label]::new(); $msg.SetBounds(20, 340, 580, 44); $msg.ForeColor = [Drawing.Color]::FromArgb(185, 28, 28)
    $ok = [Windows.Forms.Button]::new(); $ok.Text = 'تفعيل'; $ok.SetBounds(470, 400, 130, 42); $ok.BackColor = [Drawing.Color]::FromArgb(234, 88, 12); $ok.ForeColor = [Drawing.Color]::White; $ok.FlatStyle = 'Flat'
    $paste = [Windows.Forms.Button]::new(); $paste.Text = 'لصق'; $paste.SetBounds(330, 400, 130, 42)
    $paste.Add_Click({ try { if ([Windows.Forms.Clipboard]::ContainsText()) { $ta.Text = [Windows.Forms.Clipboard]::GetText() } } catch {} }.GetNewClosure())
    $exit = [Windows.Forms.Button]::new(); $exit.Text = 'إغلاق'; $exit.SetBounds(20, 400, 130, 42); $exit.DialogResult = 'Cancel'
    $state = @{ done = $false }
    $ok.Add_Click({
        try {
            if ([DalalaRestaurantLicense.Guard]::Activate($ta.Text)) { $state.done = $true; $f.DialogResult = 'OK'; $f.Close() }
            else { $msg.Text = 'رقم التفعيل غير صحيح أو لا يخص هذا الجهاز. تأكد من نسخه كاملاً.' }
        } catch { $msg.Text = 'تعذر حفظ التفعيل: ' + $_.Exception.Message }
    }.GetNewClosure())
    $f.AcceptButton = $ok; $f.CancelButton = $exit
    $f.Controls.AddRange(@($title, $help, $l1, $tm, $copy, $l2, $ta, $msg, $paste, $exit, $ok))
    [void]$f.ShowDialog(); $f.Dispose()
    return [bool]$state.done
}
function global:Invoke-LicenseGate {
    try { Load-Libraries } catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message, $global:AppTitle, 'OK', 'Error') | Out-Null; return $false }
    $chk = Test-LicenseFiles
    if (-not $chk.ok) {
        [Windows.Forms.MessageBox]::Show(('تم اكتشاف تعديل أو نقص في ملفات المنظومة، ولن تعمل حتى تُعاد من نسخة أصلية.' + [Environment]::NewLine + $chk.problem), $global:AppTitle, 'OK', 'Error') | Out-Null
        return $false
    }
    if ([DalalaRestaurantLicense.Guard]::IsActivated()) { return $true }
    return (Show-ActivationDialog)
}
function global:Start-LicenseWatch {
    # يعيد فحص التفعيل وسلامة الملفات كل 5 دقائق أثناء التشغيل
    $global:LicenseTimer = [Windows.Forms.Timer]::new(); $global:LicenseTimer.Interval = 300000
    $global:LicenseTimer.Add_Tick({
        try {
            $bad = ''
            if (-not [DalalaRestaurantLicense.Guard]::IsActivated()) { $bad = 'فُقد تفعيل المنظومة على هذا الجهاز.' }
            else { $c = Test-LicenseFiles; if (-not $c.ok) { $bad = 'تم اكتشاف تعديل في ملفات المنظومة: ' + $c.problem } }
            if ($bad) {
                $global:LicenseTimer.Stop()
                [Windows.Forms.MessageBox]::Show(($bad + [Environment]::NewLine + 'سيتم إغلاق المنظومة.'), $global:AppTitle, 'OK', 'Error') | Out-Null
                [Windows.Forms.Application]::Exit()
            }
        } catch {}
    })
    $global:LicenseTimer.Start()
}

# ===================== عدة أجهزة بقاعدة بيانات واحدة (الشبكة المحلية) =====================
function global:Get-NetFile { Join-Path $global:DataDir 'network.json' }
function global:Get-NetConfig {
    $c = @{ mode = 'local'; port = 47630; key = ''; host = '' }
    try {
        $o = $global:Ser.DeserializeObject([IO.File]::ReadAllText((Get-NetFile), [Text.Encoding]::UTF8))
        foreach ($k in @('mode', 'port', 'key', 'host')) { if ($o.ContainsKey($k) -and $null -ne $o[$k]) { $c[$k] = $o[$k] } }
    } catch {}
    if (@('local', 'host', 'client') -notcontains [string]$c.mode) { $c.mode = 'local' }
    $c.port = [int]$c.port
    return $c
}
function global:Save-NetConfig($c) {
    New-Item -ItemType Directory -Force -Path $global:DataDir | Out-Null
    [IO.File]::WriteAllText((Get-NetFile), $global:Ser.Serialize($c), [Text.UTF8Encoding]::new($false))
}
function global:Get-LanAddresses {
    $out = @()
    try {
        foreach ($ni in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback') { continue }
            foreach ($ua in $ni.GetIPProperties().UnicastAddresses) { if ($ua.Address.AddressFamily -eq 'InterNetwork') { $out += $ua.Address.IPAddressToString } }
        }
    } catch {}
    return $out
}
function global:Ensure-Firewall([int]$Port) {
    # قاعدة جدار الحماية للمنفذ (تحتاج صلاحية مدير: تظهر نافذة UAC مرة واحدة)
    try {
        $rule = 'Dalala Restaurant ' + $Port
        & "$env:SystemRoot\System32\netsh.exe" advfirewall firewall show rule name="$rule" | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Process -FilePath "$env:SystemRoot\System32\netsh.exe" -ArgumentList @('advfirewall', 'firewall', 'add', 'rule', "name=$rule", 'dir=in', 'action=allow', 'protocol=TCP', "localport=$Port", 'profile=private,domain') -Verb RunAs -WindowStyle Hidden -Wait | Out-Null
    } catch {}
}
function global:Start-Servers($Net) {
    # الواجهة تُخدَّم من هذا الجهاز فقط (127.0.0.1)، وخادم قاعدة البيانات المشتركة يعمل في وضع «الجهاز الرئيسي» فقط
    $web = Join-Path $global:AppRoot 'web'
    if (-not (Test-Path -LiteralPath (Join-Path $web 'index.html'))) { throw ('ملف الواجهة غير موجود: ' + (Join-Path $web 'index.html')) }
    if ($Net.mode -eq 'host') {
        if (-not $Net.key) { $Net.key = [DalalaRestaurant.NetServer]::NewKey(); Save-NetConfig $Net }
        $dir = Join-Path $global:DataDir 'shared'
        $global:NetSrv = [DalalaRestaurant.NetServer]::new([int]$Net.port, [string]$Net.key, $dir, $null)
        try { $global:NetSrv.Listen(); Write-AppError 'net server' ('listening on port ' + $Net.port) } catch {
            Write-AppError 'net server FAILED' ($_ | Out-String)
            $global:NetErr = $_.Exception.Message
            [Windows.Forms.MessageBox]::Show(('تعذر تشغيل خادم الشبكة على المنفذ ' + $Net.port + [Environment]::NewLine + $_.Exception.Message), $global:AppTitle, 'OK', 'Warning') | Out-Null
            $global:NetSrv = $null
        }
    }
}
function global:Test-NetHost($HostName, $Port, $Key) {
    try {
        $req = [Net.HttpWebRequest]::Create('http://' + $HostName + ':' + $Port + '/api/ping'); $req.Timeout = 4000; $req.Headers.Add('x-dalala-key', [string]$Key)
        $resp = $req.GetResponse(); $sr = [IO.StreamReader]::new($resp.GetResponseStream()); $t = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
        $o = $global:Ser.DeserializeObject($t); $o['ok'] = $true; return $o
    } catch { return @{ ok = $false; error = $_.Exception.Message } }
}

# ===================== النسخ الاحتياطي التلقائي (ملفات على القرص) =====================
function global:Get-BackupDir { Join-Path $global:DataDir 'backups' }
function global:Get-BackupName([string]$n) { return ([regex]::Replace([string]$n, '[^A-Za-z0-9_.-]', '')) }
function global:Save-Backup([string]$Name, [string]$Json) {
    $n = Get-BackupName $Name; if (-not $n -or $n.Length -gt 80 -or -not $Json -or $Json.Length -gt 300MB) { return $false }
    try {
        $dir = Get-BackupDir; New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $f = Join-Path $dir ($n + '.json'); $tmp = $f + '.tmp'
        [IO.File]::WriteAllText($tmp, $Json, [Text.UTF8Encoding]::new($false)); if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }; Move-Item -LiteralPath $tmp -Destination $f
        $all = @(Get-ChildItem -LiteralPath $dir -Filter '*.json' | Sort-Object LastWriteTime -Descending)
        @($all | Where-Object { $_.Name -like 'auto-*' } | Select-Object -Skip 30) | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        @($all | Where-Object { $_.Name -notlike 'auto-*' } | Select-Object -Skip 40) | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        return $true
    } catch { Write-AppError 'backup save' ($_ | Out-String); return $false }
}

# ===================== جسر الرسائل بين الواجهة والبرنامج =====================
function global:Invoke-HostCall([string]$Method, $Arg) {
    switch ($Method) {
        'net.info' {
            $c = Get-NetConfig
            $srv = $null; if ($global:NetSrv) { $srv = $global:Ser.DeserializeObject($global:NetSrv.StatusJson()) }
            return @{ mode = $c.mode; port = $c.port; key = $c.key; host = $c.host; ips = @(Get-LanAddresses); hostname = [Environment]::MachineName; server = $srv; serverError = $(if ($global:NetSrv) { [string]$global:NetSrv.LastError } else { [string]$global:NetErr }) }
        }
        'net.test' { return (Test-NetHost ([string]$Arg['host']).Trim() ([int]$Arg['port']) ([string]$Arg['key']).Trim().ToUpper()) }
        'net.set' {
            $cur = Get-NetConfig
            $mode = [string]$Arg['mode']; if (@('local', 'host', 'client') -notcontains $mode) { $mode = 'local' }
            $port = 47630; try { $port = [Math]::Min(65000, [Math]::Max(1024, [int]$Arg['port'])) } catch {}
            $next = @{ mode = $mode; port = $port; host = ([string]$Arg['host']).Trim(); key = $(if ($mode -eq 'client') { ([string]$Arg['key']).Trim().ToUpper() } else { [string]$cur.key }) }
            Save-NetConfig $next
            if ($mode -eq 'host') { Ensure-Firewall $port }
            $global:RelaunchRequested = $true
            $global:MainForm.BeginInvoke([Action]{ $global:MainForm.Close() }) | Out-Null
            return $true
        }
        'bk.save' { return (Save-Backup ([string]$Arg['name']) ([string]$Arg['json'])) }
        'bk.list' {
            $dir = Get-BackupDir; if (-not (Test-Path -LiteralPath $dir)) { return @() }
            return @(Get-ChildItem -LiteralPath $dir -Filter '*.json' | Sort-Object LastWriteTime -Descending | ForEach-Object {
                @{ name = $_.BaseName; size = [long]$_.Length; mtime = [long]([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds() } })
        }
        'bk.read' { $n = Get-BackupName ([string]$Arg['name']); try { return [IO.File]::ReadAllText((Join-Path (Get-BackupDir) ($n + '.json')), [Text.Encoding]::UTF8) } catch { return '' } }
        'bk.open' { New-Item -ItemType Directory -Force -Path (Get-BackupDir) | Out-Null; Start-Process explorer.exe -ArgumentList ('"' + (Get-BackupDir) + '"'); return $true }
        'file.openLast' { if ($global:LastSaved -and (Test-Path -LiteralPath $global:LastSaved)) { Start-Process -FilePath $global:LastSaved; return $true }; return $false }
        default { return $null }
    }
}
function global:Invoke-UiMessage([string]$Text) {
    $id = 0
    try {
        $m = $global:Ser.DeserializeObject($Text); $id = [int]$m['id']
        $v = Invoke-HostCall ([string]$m['m']) $m['a']
        return $global:Ser.Serialize(@{ id = $id; v = $v })
    } catch { Write-AppError 'host call' ($_ | Out-String); return $global:Ser.Serialize(@{ id = $id; v = $null; error = [string]$_.Exception.Message }) }
}
function global:Get-PageShim($Net) {
    $lic = [DalalaRestaurantLicense.Guard]::MachineCode()
    $url = ''; if ($Net.mode -eq 'host') { $url = 'http://127.0.0.1:' + $Net.port } elseif ($Net.mode -eq 'client') { $url = 'http://' + $Net.host + ':' + $Net.port }
    $cfg = $global:Ser.Serialize(@{
        desktop = @{ licensed = $true; customer = ''; expiry = ''; issued = ''; deviceId = $lic; product = 'restaurant' }
        net = @{ mode = $Net.mode; key = [string]$Net.key; port = [int]$Net.port; host = [string]$Net.host; name = [Environment]::MachineName; url = $url }
    })
    $js = @'
(function(){
 var cfg = __CFG__;
 var pend = {}, seq = 0;
 function call(m, a) { return new Promise(function (res) { var id = ++seq; pend[id] = res; window.chrome.webview.postMessage(JSON.stringify({ id: id, m: m, a: a === undefined ? null : a })); }); }
 window.chrome.webview.addEventListener('message', function (e) { var r = e.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (x) { return; } } var f = pend[r.id]; if (f) { delete pend[r.id]; f(r.v); } });
 function def(n, v) { Object.defineProperty(window, n, { value: Object.freeze(v), writable: false, configurable: false }); }
 def('dalalaDesktop', cfg.desktop);
 def('dalalaNet', { config: Object.freeze(cfg.net), info: function () { return call('net.info'); }, test: function (o) { return call('net.test', o); }, set: function (o) { return call('net.set', o); } });
 def('dalalaBackup', { save: function (n, j) { return call('bk.save', { name: n, json: j }); }, list: function () { return call('bk.list'); }, read: function (n) { return call('bk.read', { name: n }); }, open: function () { return call('bk.open'); } });
 def('dalalaFiles', { onSaved: function (cb) { window.__dalalaSaved = cb; }, openLast: function () { return call('file.openLast'); } });
})();
'@
    return $js.Replace('__CFG__', $cfg)
}

# ===================== النافذة الرئيسية (WebView2) =====================
function global:Initialize-WebView2Library {
    $dir = Join-Path $global:AppRoot 'webview2'
    $core = Join-Path $dir 'Microsoft.Web.WebView2.Core.dll'; $wf = Join-Path $dir 'Microsoft.Web.WebView2.WinForms.dll'
    foreach ($f in @($core, $wf)) { if (-not (Test-Path -LiteralPath $f)) { throw ('ملف مكتبة العرض مفقود: ' + $f) } }
    $arch = if ([Environment]::Is64BitProcess) { if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' } } else { 'x86' }
    $loader = Join-Path (Join-Path $dir $arch) 'WebView2Loader.dll'
    if (-not (Test-Path -LiteralPath $loader)) { throw ('WebView2Loader.dll مفقود: ' + $loader) }
    if (-not ('DalalaNative.Loader' -as [type])) {
        Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;namespace DalalaNative{public static class Loader{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr LoadLibraryW(string path);}}'
    }
    if ([DalalaNative.Loader]::LoadLibraryW($loader) -eq [IntPtr]::Zero) { throw ('تعذر تحميل ' + $loader + ' (رمز الخطأ ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')') }
    Add-Type -Path $core; Add-Type -Path $wf
}
function global:Show-WebViewMissingMessage([string]$Detail) {
    $msg = 'تعذر تشغيل محرك العرض الحديث (Microsoft Edge WebView2).' + [Environment]::NewLine + [Environment]::NewLine +
           'ثبّت «WebView2 Runtime» من موقع مايكروسوفت ثم أعد تشغيل المنظومة:' + [Environment]::NewLine + 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' + [Environment]::NewLine + [Environment]::NewLine + 'التفاصيل: ' + $Detail
    [Windows.Forms.MessageBox]::Show($msg, $global:AppTitle, 'OK', 'Warning') | Out-Null
}
function global:Start-WebApp {
    $net = Get-NetConfig
    Initialize-WebView2Library
    Start-Servers $net
    $form = [Windows.Forms.Form]::new()
    $form.Text = $global:AppTitle; $form.StartPosition = 'CenterScreen'; $form.WindowState = 'Maximized'; $form.MinimumSize = [Drawing.Size]::new(1000, 640)
    $form.BackColor = [Drawing.Color]::FromArgb(15, 23, 42)
    $icon = Join-Path $global:AppRoot 'Dalala.ico'; if (Test-Path -LiteralPath $icon) { try { $form.Icon = [Drawing.Icon]::new($icon) } catch {} }
    $global:MainForm = $form
    $wv = [Microsoft.Web.WebView2.WinForms.WebView2]::new()
    $wv.Dock = 'Fill'; $wv.DefaultBackgroundColor = [Drawing.Color]::FromArgb(15, 23, 42)
    $props = [Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties]::new()
    $props.UserDataFolder = Join-Path $global:DataDir 'webview2-data'
    # الواجهة محلية فقط: نمنع تمرير الاتصال عبر أي وكيل (Proxy/VPN) لأنه قد يعيد تعيين الاتصال
    $props.AdditionalBrowserArguments = '--no-proxy-server --allow-running-insecure-content --disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults'
    $wv.CreationProperties = $props
    $form.Controls.Add($wv); $global:WebView = $wv
    $shim = Get-PageShim $net
    $uiUrl = 'https://dalala-restaurant.app/index.html'
    $wv.Add_CoreWebView2InitializationCompleted({
        param($s, $e)
        if (-not $e.IsSuccess) { Write-AppError 'WebView2 init' ($e.InitializationException | Out-String); Show-WebViewMissingMessage ([string]$e.InitializationException.Message); $global:MainForm.Close(); return }
        try {
            $core = $s.CoreWebView2; $st = $core.Settings
            foreach ($kv in @(@('AreDevToolsEnabled', $false), @('AreDefaultContextMenusEnabled', $false), @('IsStatusBarEnabled', $false), @('IsZoomControlEnabled', $false), @('AreBrowserAcceleratorKeysEnabled', $false))) {
                try { $st.($kv[0]) = $kv[1] } catch { }
            }
            $core.add_NavigationCompleted({ param($a, $b) if (-not $b.IsSuccess) { Write-AppError 'NavigationCompleted failed' ('WebErrorStatus=' + [string]$b.WebErrorStatus + ' server=' + [DalalaRestaurant.MiniHttp]::LastError) } })
            $core.add_ContainsFullScreenElementChanged({
                param($a, $b)
                try {
                    $f = $global:MainForm
                    if ($global:WebView.CoreWebView2.ContainsFullScreenElement) {
                        $f.WindowState = 'Normal'; $f.FormBorderStyle = 'None'
                        $f.Bounds = [Windows.Forms.Screen]::FromControl($f).Bounds
                    } else {
                        $f.FormBorderStyle = 'Sizable'; $f.WindowState = 'Maximized'
                    }
                } catch { Write-AppError 'fullscreen' ($_ | Out-String) }
            })
            $core.add_NewWindowRequested({ param($a, $b) $b.Handled = $true })
            $core.add_NavigationStarting({ param($a, $b) if (-not ([string]$b.Uri).StartsWith('https://dalala-restaurant.app/')) { $b.Cancel = $true; if ([string]$b.Uri -match '^https?://') { try { Start-Process ([string]$b.Uri) } catch {} } } })
            $core.add_WebMessageReceived({
                param($a, $b)
                $resp = $null
                try { $resp = Invoke-UiMessage ([string]$b.TryGetWebMessageAsString()) } catch { Write-AppError 'WebMessage' ($_ | Out-String); $resp = '{"id":0,"error":"internal"}' }
                try { $a.PostWebMessageAsString($resp) } catch { Write-AppError 'PostWebMessage' ($_ | Out-String) }
            })
            $core.add_DownloadStarting({
                param($a, $b)
                try {
                    $b.Handled = $true
                    $dlg = [Windows.Forms.SaveFileDialog]::new(); $dlg.Title = 'حفظ الملف — Save file'
                    $dlg.InitialDirectory = [Environment]::GetFolderPath('MyDocuments'); $dlg.FileName = [IO.Path]::GetFileName([string]$b.ResultFilePath)
                    if ($dlg.ShowDialog($global:MainForm) -eq 'OK') {
                        $b.ResultFilePath = $dlg.FileName; $global:LastSaved = $dlg.FileName
                        $op = $b.DownloadOperation
                        $op.add_StateChanged({ param($x, $y) try { if ([string]$x.State -eq 'Completed') { $global:WebView.CoreWebView2.ExecuteScriptAsync('window.__dalalaSaved&&window.__dalalaSaved(' + $global:Ser.Serialize($global:LastSaved) + ')') | Out-Null } } catch {} })
                    } else { $b.Cancel = $true }
                } catch { Write-AppError 'download' ($_ | Out-String) }
            })
            $core.SetVirtualHostNameToFolderMapping('dalala-restaurant.app', (Join-Path $global:AppRoot 'web'), [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
            $core.AddScriptToExecuteOnDocumentCreatedAsync($shim) | Out-Null
            $core.Navigate($uiUrl)
        } catch { Write-AppError 'WebView2 setup' ($_ | Out-String); Show-WebViewMissingMessage $_.Exception.Message; $global:MainForm.Close() }
    })
    $form.Add_Shown({ try { $global:WebView.EnsureCoreWebView2Async($null) | Out-Null } catch { Write-AppError 'EnsureCoreWebView2Async' ($_ | Out-String); Show-WebViewMissingMessage $_.Exception.Message; $global:MainForm.Close() } })
    $form.Add_FormClosing({ try { if ($global:NetSrv) { $global:NetSrv.Close() } } catch {}; try { if ($global:UiSrv) { $global:UiSrv.Stop() } } catch {} })
    Start-LicenseWatch
    [void][Windows.Forms.Application]::Run($form)
}

# ===================== التشغيل =====================
try {
    New-Item -ItemType Directory -Force -Path $global:DataDir | Out-Null
    if (-not (Invoke-LicenseGate)) { return }
    $global:RelaunchRequested = $false
    Start-WebApp
    if ($global:RelaunchRequested) {
        # إعادة التشغيل بعد تغيير إعدادات الشبكة: ننتظر قليلاً حتى يتحرر قفل النسخة الواحدة ثم نفتح البرنامج من جديد
        $exe = Join-Path $global:AppRoot 'Dalala.exe'
        Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList ('/c ping -n 4 127.0.0.1 >nul & start "" "' + $exe + '"') -WindowStyle Hidden
    }
} catch {
    Write-AppError 'startup' ($_ | Out-String)
    [Windows.Forms.MessageBox]::Show(('تعذر تشغيل المنظومة: ' + $_.Exception.Message + [Environment]::NewLine + 'التفاصيل في: ' + $global:LogPath), $global:AppTitle, 'OK', 'Error') | Out-Null
    exit 1
}
