' Script VBS para execucao 100% silenciosa do RPA DHL
Set objShell = CreateObject("Wscript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strCmd = "node """ & strPath & "\rpa_sync.js"""
objShell.Run strCmd, 0, False
