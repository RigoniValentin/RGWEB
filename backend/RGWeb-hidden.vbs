' RGWeb-hidden.vbs — Lanza RGWeb.exe sin ventana de consola
' Usado por el acceso directo del instalador (wscript.exe)
Dim WshShell, strDir
Set WshShell = CreateObject("WScript.Shell")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.Run Chr(34) & strDir & "RGWeb.exe" & Chr(34), 0, False
Set WshShell = Nothing
