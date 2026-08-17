Set s = CreateObject("WScript.Shell")
s.CurrentDirectory = "V:\cy"
s.Run "cmd /c node runnerun.js >> runner\stateun.out.log 2>&1", 0, False
