' Mi Edificio: inicia el servidor si hace falta y lo abre en el navegador (sin mostrar ventanas)
Dim carpeta, shell
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
If shell.Run("""" & carpeta & "\node.exe"" """ & carpeta & "\local\lanzar.mjs"" abrir", 0, True) <> 0 Then
  MsgBox "Mi Edificio no pudo iniciar." & vbCrLf & vbCrLf & "Revisa el archivo servidor.log en la carpeta de datos:" & vbCrLf & shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\MiEdificio\datos", 16, "Mi Edificio"
End If
