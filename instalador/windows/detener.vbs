' Mi Edificio: detiene el servidor ordenadamente (sin mostrar ventanas)
Dim carpeta, shell
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
If MsgBox("Mientras esté detenido, nadie podrá entrar a la app." & vbCrLf & "Antes de cerrarse, hace un respaldo." & vbCrLf & vbCrLf & "¿Detener Mi Edificio?", 36, "Mi Edificio") = 6 Then
  If shell.Run("""" & carpeta & "\node.exe"" """ & carpeta & "\local\lanzar.mjs"" detener", 0, True) = 0 Then
    MsgBox "Mi Edificio se detuvo.", 64, "Mi Edificio"
  Else
    MsgBox "No se pudo confirmar que Mi Edificio se detuvo.", 48, "Mi Edificio"
  End If
End If
