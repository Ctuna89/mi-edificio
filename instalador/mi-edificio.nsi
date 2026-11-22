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
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!define GUIA_NUBE "https://github.com/Ctuna89/mi-edificio#instalaci%C3%B3n-alternativa-supabase"
Var RadioLocal
Var RadioNube

!define MUI_ABORTWARNING
!define MUI_ICON "${ETAPA}\icono.ico"
!define MUI_UNICON "${ETAPA}\icono.ico"
!define MUI_WELCOMEPAGE_TITLE "Instalar ${NOMBRE} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "${NOMBRE} es una app para residentes, conserjería, comité y administración de un edificio.$\r$\n$\r$\nEste asistente te preguntará primero dónde quieres que funcione y, si eliges este computador, lo deja instalado y listo para usar.$\r$\n$\r$\nLo habitual es instalarlo en un computador que permanezca encendido, como el de conserjería o administración."
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_TITLE "${NOMBRE} quedó instalado"
!define MUI_FINISHPAGE_TEXT "Al abrirlo se mostrará en tu navegador. La primera persona que cree una cuenta configura el edificio y queda como administradora.$\r$\n$\r$\nSi Windows pregunta por el acceso a la red, permítelo en redes privadas para que otros equipos del edificio puedan entrar.$\r$\n$\r$\nPara que los residentes entren desde sus teléfonos, revisa $\"Acceso desde internet$\" en la documentación."
!define MUI_FINISHPAGE_RUN "$SYSDIR\wscript.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "$\"$INSTDIR\abrir.vbs$\""
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${NOMBRE} ahora"
!define MUI_FINISHPAGE_LINK "Documentación y código fuente"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/Ctuna89/mi-edificio"

!insertmacro MUI_PAGE_WELCOME
Page custom PaginaDonde PaginaDondeSalir
!insertmacro MUI_PAGE_LICENSE "${ETAPA}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

; Primera decisión: ¿en este computador o en la nube? Este instalador solo hace lo primero;
; para la nube muestra la guía y termina, sin instalar nada. (En modo silencioso no se pregunta.)
Function PaginaDonde
  !insertmacro MUI_HEADER_TEXT "¿Dónde va a funcionar ${NOMBRE}?" "Elige una opción para continuar."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "En este computador  (recomendado: más simple)"
  Pop $RadioLocal
  ${NSD_AddStyle} $RadioLocal ${WS_GROUP}
  ${NSD_CreateLabel} 12u 14u 96% 34u "Todo queda instalado y guardado aquí, sin cuentas ni servicios externos. A cambio, este computador debe permanecer encendido y conectado: si se apaga, la app deja de responder. Conviene respaldar los datos en una nube (se configura después, dentro de la app)."
  Pop $0
  ${NSD_CreateRadioButton} 0 56u 100% 12u "En la nube  (avanzado: más complejo)"
  Pop $RadioNube
  ${NSD_CreateLabel} 12u 70u 96% 42u "No depende de este computador, pero hay que crear y configurar cuentas en servicios externos (Supabase y un hosting web), lo que requiere conocimientos técnicos y puede tener costo. Este instalador no lo hace: te muestra la guía y termina sin instalar nada. Es una opción todavía experimental."
  Pop $0
  ${NSD_Check} $RadioLocal
  nsDialogs::Show
FunctionEnd

Function PaginaDondeSalir
  ${NSD_GetState} $RadioNube $0
  ${If} $0 == ${BST_CHECKED}
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "La instalación en la nube se hace a mano, siguiendo la guía del proyecto.$\r$\n$\r$\nAl aceptar se abrirá la guía en el navegador y este instalador se cerrará sin instalar nada.$\r$\n$\r$\nSi prefieres la opción simple, cancela y elige $\"En este computador$\"." IDCANCEL seguir_aqui
    ExecShell "open" "${GUIA_NUBE}"
    Quit
    seguir_aqui:
    Abort
  ${EndIf}
FunctionEnd

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
  ; instalación silenciosa (actualización con un clic): no hay página final, así que se inicia aquí
  IfSilent 0 +2
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\iniciar.vbs"'
SectionEnd

Section "Iniciar junto con Windows" SecInicio
  CreateShortcut "$SMSTARTUP\${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\iniciar.vbs"' "$INSTDIR\icono.ico"
SectionEnd

Section "Acceso directo en el escritorio" SecEscritorio
  CreateShortcut "$DESKTOP\${NOMBRE}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\abrir.vbs"' "$INSTDIR\icono.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPrincipal} "La app, su servidor, Node.js y el programa para el acceso desde internet. No requiere instalar nada más."
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
  Delete "$INSTDIR\cloudflared.exe"
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
