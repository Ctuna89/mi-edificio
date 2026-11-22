; =====================================================================
;  Instalador de Mi Edificio para Windows (NSIS 3).  Se construye con instalador/construir.sh
;  Instala para el usuario actual, sin pedir permisos de administrador:
;    programa → %LOCALAPPDATA%\Programs\Mi Edificio     (incluye Node.js: no hay que instalar nada más)
;    datos    → %LOCALAPPDATA%\MiEdificio\datos         (no se tocan al actualizar ni al desinstalar)
; =====================================================================
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef ETAPA
  !define ETAPA "etapa"
!endif
!ifndef SALIDA
  !define SALIDA "MiEdificio-Instalar.exe"
!endif
!define NOMBRE "Mi Edificio"
!define CLAVE_DESINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiEdificio"

Name "${NOMBRE}"
BrandingText "${NOMBRE} ${VERSION}"
OutFile "${SALIDA}"
InstallDir "$LOCALAPPDATA\Programs\Mi Edificio"
InstallDirRegKey HKCU "Software\MiEdificio" "Carpeta"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NOMBRE}"
VIAddVersionKey "FileDescription" "Instalador de ${NOMBRE}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Licencia MIT"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "${ETAPA}\icono.ico"
!define MUI_UNICON "${ETAPA}\icono.ico"
!define MUI_WELCOMEPAGE_TITLE "Instalar ${NOMBRE} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala ${NOMBRE} en este computador, que quedará como servidor del edificio.$\r$\n$\r$\nLa app, la base de datos y los archivos se guardan aquí mismo: no se necesita ninguna cuenta ni servicio externo.$\r$\n$\r$\nConviene instalarlo en un computador que permanezca encendido, como el de conserjería o administración."
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_TITLE "${NOMBRE} quedó instalado"
!define MUI_FINISHPAGE_TEXT "Al abrirlo se mostrará en tu navegador. La primera persona que cree una cuenta configura el edificio y queda como administradora.$\r$\n$\r$\nSi Windows pregunta por el acceso a la red, permítelo en redes privadas para que otros equipos del edificio puedan entrar.$\r$\n$\r$\nPara que los residentes entren desde sus teléfonos, revisa $\"Acceso desde internet$\" en la documentación."
!define MUI_FINISHPAGE_RUN "$SYSDIR\wscript.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "$\"$INSTDIR\abrir.vbs$\""
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${NOMBRE} ahora"
!define MUI_FINISHPAGE_LINK "Documentación y código fuente"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/Ctuna89/mi-edificio"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ETAPA}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

; Detiene el servidor si está corriendo (para actualizar o desinstalar sin archivos en uso)
!macro DetenerServidor
  ${If} ${FileExists} "$INSTDIR\node.exe"
  ${AndIf} ${FileExists} "$INSTDIR\local\lanzar.mjs"
    DetailPrint "Deteniendo ${NOMBRE}, si está en uso…"
    nsExec::Exec '"$INSTDIR\node.exe" "$INSTDIR\local\lanzar.mjs" detener'
    Pop $0
  ${EndIf}
!macroend

Section "${NOMBRE} (requerido)" SecPrincipal
  SectionIn RO
  !insertmacro DetenerServidor
  ; una actualización reemplaza el programa completo; los datos viven en otra carpeta
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\local"
  RMDir /r "$INSTDIR\supabase"
  SetOutPath "$INSTDIR"
  File /r "${ETAPA}\*.*"
  WriteUninstaller "$INSTDIR\desinstalar.exe"
  WriteRegStr HKCU "Software\MiEdificio" "Carpeta" "$INSTDIR"
  WriteRegStr HKCU "${CLAVE_DESINST}" "DisplayName" "${NOMBRE}"
  WriteRegStr HKCU "${CLAVE_DESINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${CLAVE_DESINST}" "Publisher" "Mi Edificio (código abierto)"
  WriteRegStr HKCU "${CLAVE_DESINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CLAVE_DESINST}" "UninstallString" '"$INSTDIR\desinstalar.exe"'
  WriteRegStr HKCU "${CLAVE_DESINST}" "URLInfoAbout" "https://github.com/Ctuna89/mi-edificio"
  WriteRegDWORD HKCU "${CLAVE_DESINST}" "NoModify" 1
  WriteRegDWORD HKCU "${CLAVE_DESINST}" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Abrir ${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\abrir.vbs"' "$INSTDIR\icono.ico"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Detener ${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\detener.vbs"' "$INSTDIR\icono.ico"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Desinstalar ${NOMBRE}.lnk" "$INSTDIR\desinstalar.exe"
SectionEnd

Section "Iniciar junto con Windows" SecInicio
  CreateShortcut "$SMSTARTUP\${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\iniciar.vbs"' "$INSTDIR\icono.ico"
SectionEnd

Section "Acceso directo en el escritorio" SecEscritorio
  CreateShortcut "$DESKTOP\${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\abrir.vbs"' "$INSTDIR\icono.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPrincipal} "La app, su servidor y Node.js. No requiere instalar nada más."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecInicio} "Recomendado: el servidor parte solo cuando este usuario inicia sesión en Windows, para que la app esté siempre disponible."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecEscritorio} "Un ícono en el escritorio para abrir la app en el navegador."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro DetenerServidor
  Delete "$SMSTARTUP\${NOMBRE}.lnk"
  Delete "$DESKTOP\${NOMBRE}.lnk"
  RMDir /r "$SMPROGRAMS\${NOMBRE}"
  ; solo lo que instalamos: nunca la carpeta completa, por si alguien eligió una con otras cosas
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\local"
  RMDir /r "$INSTDIR\supabase"
  ; node.exe puede seguir ocupado un instante después de detener el servidor
  StrCpy $1 0
  borrar_node:
    Delete "$INSTDIR\node.exe"
    ${If} ${FileExists} "$INSTDIR\node.exe"
    ${AndIf} $1 < 20
      IntOp $1 $1 + 1
      Sleep 500
      Goto borrar_node
    ${EndIf}
  Delete "$INSTDIR\abrir.vbs"
  Delete "$INSTDIR\iniciar.vbs"
  Delete "$INSTDIR\detener.vbs"
  Delete "$INSTDIR\icono.ico"
  Delete "$INSTDIR\instalado.txt"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\LEEME.txt"
  Delete "$INSTDIR\desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${CLAVE_DESINST}"
  DeleteRegKey HKCU "Software\MiEdificio"
  IfSilent +2
  MessageBox MB_ICONINFORMATION "${NOMBRE} se desinstaló.$\r$\n$\r$\nLos datos de tu edificio se conservan en:$\r$\n$LOCALAPPDATA\MiEdificio\datos$\r$\n$\r$\nBorra esa carpeta solo si ya no los necesitas."
SectionEnd
