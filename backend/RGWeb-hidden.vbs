' ═══════════════════════════════════════════════════
'   Río Gestión WEB — Hidden Launcher
'   Ejecuta RGWeb.exe sin mostrar ventana de consola
' ═══════════════════════════════════════════════════
Dim objShell, scriptDir
Set objShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = scriptDir
objShell.Run """" & scriptDir & "\RGWeb.exe""", 0, False
Set objShell = Nothing
