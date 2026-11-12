Unicode true
!define APP "منظومة دلالة للمطاعم والمقاهي"
!define VER "1.2.2"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DalalaRestaurant"
!ifndef SRC
 !define SRC "stage"
!endif
Name "${APP} ${VER}"
OutFile "Dalala-Restaurant-Setup-${VER}-WebView2.exe"
InstallDir "$PROGRAMFILES64\Dalala Restaurant"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "${APP} ${VER}"
ShowInstDetails show
VIProductVersion "1.2.2.0"
VIAddVersionKey /LANG=1025 "ProductName" "${APP}"
VIAddVersionKey /LANG=1025 "CompanyName" "Dalala"
VIAddVersionKey /LANG=1025 "FileDescription" "مثبّت ${APP}"
VIAddVersionKey /LANG=1025 "FileVersion" "${VER}"
VIAddVersionKey /LANG=1025 "ProductVersion" "${VER}"
VIAddVersionKey /LANG=1025 "LegalCopyright" "Dalala"

!include MUI2.nsh
!include LogicLib.nsh
!include x64.nsh
!include WinVer.nsh
!include FileFunc.nsh

!define MUI_ICON "${SRC}/Dalala.ico"
!define MUI_UNICON "${SRC}/Dalala.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Dalala.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل ${APP} الآن"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.html"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "فتح دليل المنظومة"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "يلزم Windows 10 أو أحدث."
    Abort
  ${EndIf}
  ${If} ${RunningX64}
    SetRegView 64
    StrCpy $INSTDIR "$PROGRAMFILES64\Dalala Restaurant"
  ${EndIf}
  ; Windows PowerShell 5.1
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine" "PowerShellVersion"
  ${If} $0 == ""
    MessageBox MB_ICONSTOP "يلزم Windows PowerShell 5.1."
    Abort
  ${EndIf}
  System::Call 'kernel32::OpenMutex(i 0x100000, b 0, t "Local\DalalaRestaurant1") p .r1'
  ${If} $1 <> 0
    System::Call 'kernel32::CloseHandle(p r1)'
    MessageBox MB_ICONSTOP "المنظومة تعمل حالياً. أغلقها ثم أعد تشغيل المثبّت."
    Abort
  ${EndIf}
FunctionEnd

Section "Install"
  SetShellVarContext all
  ; replace old program files (data in %LOCALAPPDATA%\DalalaRestaurant and the license are never touched)
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\webview2"
  SetOutPath "$INSTDIR"
  File "${SRC}/Dalala.exe"
  File "${SRC}/DalalaLauncher.ps1"
  File "${SRC}/DalalaRestaurant.ps1"
  File "${SRC}/DalalaLicense.dll"
  File "${SRC}/DalalaCore.dll"
  File "${SRC}/license.manifest"
  File "${SRC}/Dalala.ico"
  File "${SRC}/README.html"
  File "${SRC}/README.txt"
  SetOutPath "$INSTDIR\web"
  File "${SRC}/web\index.html"
  SetOutPath "$INSTDIR\web\assets"
  File "${SRC}/web\assets\icon.png"
  File "${SRC}/web\assets\logo.svg"
  File "${SRC}/web\assets\sync.js"
  SetOutPath "$INSTDIR\webview2"
  File "${SRC}/webview2\Microsoft.Web.WebView2.Core.dll"
  File "${SRC}/webview2\Microsoft.Web.WebView2.WinForms.dll"
  SetOutPath "$INSTDIR\webview2\x86"
  File "${SRC}/webview2\x86\WebView2Loader.dll"
  SetOutPath "$INSTDIR\webview2\x64"
  File "${SRC}/webview2\x64\WebView2Loader.dll"
  SetOutPath "$INSTDIR\webview2\arm64"
  File "${SRC}/webview2\arm64\WebView2Loader.dll"
  SetOutPath "$INSTDIR"

  ; firewall: the default network port for the main computer (private/domain networks only)
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="Dalala Restaurant 47630"'
  Pop $0
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="Dalala Restaurant 47630" dir=in action=allow protocol=TCP localport=47630 profile=private,domain'
  Pop $0

  CreateDirectory "$SMPROGRAMS\Dalala Restaurant"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\Dalala.exe" "" "$INSTDIR\Dalala.ico" 0
  CreateShortcut "$SMPROGRAMS\Dalala Restaurant\${APP}.lnk" "$INSTDIR\Dalala.exe" "" "$INSTDIR\Dalala.ico" 0
  CreateShortcut "$SMPROGRAMS\Dalala Restaurant\دليل المنظومة.lnk" "$INSTDIR\README.html"
  CreateShortcut "$SMPROGRAMS\Dalala Restaurant\إلغاء تثبيت ${APP}.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${REGKEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${REGKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKLM "${REGKEY}" "Publisher" "Dalala"
  WriteRegStr HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "DisplayIcon" "$INSTDIR\Dalala.ico"
  WriteRegStr HKLM "${REGKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${REGKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REGKEY}" "EstimatedSize" $0
SectionEnd

Function un.onInit
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\Dalala Restaurant"
  DeleteRegKey HKLM "${REGKEY}"
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="Dalala Restaurant 47630"'
  Pop $0
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "هل تريد أيضاً حذف بيانات المنظومة (الفواتير والنسخ الاحتياطية) لهذا المستخدم نهائياً؟$\r$\nاختر «لا» للاحتفاظ بها." IDNO keepdata
    ReadEnvStr $R0 LOCALAPPDATA
    RMDir /r "$R0\DalalaRestaurant"
  keepdata:
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"
SectionEnd
