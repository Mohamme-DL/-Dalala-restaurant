; Dalala Restaurant — Windows installer (NSIS, Arabic + English)
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME     "Dalala Restaurant"
!define APPNAME_AR  "منظومة دلالة للمطاعم والمقاهي"
!ifndef VERSION
  !define VERSION   "1.1.0"
!endif
!define EXE         "Dalala Restaurant.exe"
!define UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\DalalaRestaurant"

Name "${APPNAME_AR} - ${APPNAME}"
OutFile "dist/Dalala-Restaurant-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Dalala Restaurant"
InstallDirRegKey HKCU "Software\DalalaRestaurant" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME_AR} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1033 "FileDescription" "${APPNAME} Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "Dalala"
VIAddVersionKey /LANG=1033 "LegalCopyright" "© Dalala"

!define MUI_ICON "build/icon.ico"
!define MUI_UNICON "build/icon.ico"
!define MUI_ABORTWARNING
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_RESERVEFILE_LANGDLL

LangString DesktopLnk ${LANG_ARABIC}  "${APPNAME_AR}"
LangString DesktopLnk ${LANG_ENGLISH} "${APPNAME}"
LangString UninstLnk ${LANG_ARABIC}  "إزالة ${APPNAME_AR}"
LangString UninstLnk ${LANG_ENGLISH} "Uninstall ${APPNAME}"
LangString KeepData ${LANG_ARABIC}  "ملاحظة: بيانات المدرسة محفوظة في مجلد المستخدم ولن تُحذف. يمكن حذفها يدوياً من: $APPDATA\${APPNAME}"
LangString KeepData ${LANG_ENGLISH} "Note: school data is kept in your user folder and is not deleted. You can remove it manually from: $APPDATA\${APPNAME}"

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd
Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "Install"
  ; make sure a running copy does not lock files
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 400
  SetOutPath "$INSTDIR"
  File /r "dist/win-unpacked/*.*"
  File "build/icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME_AR}"
  CreateShortcut "$SMPROGRAMS\${APPNAME_AR}\$(DesktopLnk).lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME_AR}\$(UninstLnk).lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$DESKTOP\$(DesktopLnk).lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0

  WriteRegStr HKCU "Software\DalalaRestaurant" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME_AR} - ${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Dalala"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 400
  Delete "$DESKTOP\$(DesktopLnk).lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME_AR}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\DalalaRestaurant"
  MessageBox MB_OK|MB_ICONINFORMATION "$(KeepData)" /SD IDOK
SectionEnd
