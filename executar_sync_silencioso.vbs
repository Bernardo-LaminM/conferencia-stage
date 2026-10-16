' Script VBS para execucao 100% invisivel do atualizador do Power BI
Set objShell = CreateObject("Wscript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strCmd = "pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command ""& '" & strPath & "\atualizar_powerbi.ps1' -OutputDir '" & strPath & "'"""
objShell.Run strCmd, 0, True
