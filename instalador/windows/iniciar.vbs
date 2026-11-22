' Mi Edificio: inicia el servidor (sin mostrar ventanas)
Dim carpeta, shell
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run """" & carpeta & "\node.exe"" """ & carpeta & "\local\lanzar.mjs"" iniciar", 0, False
