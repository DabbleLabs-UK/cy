Option Explicit

Dim shell, files, runnerDir, projectDir, supervisor
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

runnerDir = files.GetParentFolderName(WScript.ScriptFullName)
projectDir = files.GetParentFolderName(runnerDir)
supervisor = files.BuildPath(runnerDir, "cy-supervisor.bat")

shell.CurrentDirectory = projectDir
shell.Run """" & supervisor & """", 0, False
