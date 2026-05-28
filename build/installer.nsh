!macro customInstall
  DetailPrint "Installing OpenScreen OCR Windows service"
  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop OpenScreenOCR'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete OpenScreenOCR'
  Sleep 1000
  ExpandEnvStrings $0 "%ProgramData%\OpenScreen\ocr-runtime"
  CreateDirectory "$0"
  nsExec::ExecToLog '"$SYSDIR\sc.exe" create OpenScreenOCR binPath= "\"$INSTDIR\resources\electron\native\bin\win32-x64\openscreen-ocr-service-wrapper.exe\" --service --exe \"$INSTDIR\resources\ocr-service\openscreen-ocr-service.exe\" --resources \"$INSTDIR\resources\" --data \"$0\"" start= auto DisplayName= "OpenScreen OCR Service"'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" description OpenScreenOCR "Local OCR service used by OpenScreen guide capture."'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" start OpenScreenOCR'
!macroend

!macro customUnInstall
  DetailPrint "Removing OpenScreen OCR Windows service"
  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop OpenScreenOCR'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete OpenScreenOCR'
!macroend
