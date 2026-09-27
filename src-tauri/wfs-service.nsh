; Installs the bundled WFSearch engine as a Windows service.
;
; The service is what makes whole-disk search work without ever elevating
; SVCode: reading a volume's MFT is an administrator-only ioctl, and the
; service runs as LocalSystem. Without it the sidecar SVCode spawns for itself
; starts fine, authenticates fine, then reports every volume as `failed`.
;
; The registered binary is a copy under %ProgramFiles%\WFSearch rather than the
; sidecar in $INSTDIR, because a service keeps its exe open for its whole
; lifetime: pointing it at the app folder would block every upgrade from
; overwriting the file and leave a dead ImagePath behind after an uninstall.
;
; Requires an elevated installer, which `installMode: "perMachine"` guarantees.

!include LogicLib.nsh
!include FileFunc.nsh

!define WFS_SVC_NAME 'WFSearch'
; Tauri installs the externalBin without its target-triple suffix.
!define WFS_SIDECAR '$INSTDIR\wfs-server.exe'
!define WFS_DIR '$PROGRAMFILES64\WFSearch'
!define WFS_EXE '${WFS_DIR}\wfs-server.exe'
; Ownership marker. "The service exists" does not imply "it is ours" -- a
; standalone WFSearch install registers the very same name, and uninstalling
; SVCode must not tear that engine down.
!define WFS_MARK_KEY 'SOFTWARE\SVCode'
!define WFS_MARK_VALUE 'WfsServiceOwned'

; nsExec always leaves its exit code on the stack; nobody needs it here.
;
; Never route a path through this macro: NSIS eats the quotes around a command
; string when it arrives as a macro parameter, so `C:\Program Files\...` reaches
; nsExec unquoted and it launches `C:\Program` instead. The result is a silent
; exit code 1, which is how the first version of this hook managed to skip
; service registration on every machine that installed into Program Files.
; Anything with a path in it gets its own nsExec call, written out in full.
!macro WfsQuiet cmd
  nsExec::ExecToLog ${cmd}
  Pop $9
!macroend

; Registers the engine and claims ownership only once the SCM really has the
; service -- the exit code of `install` is not evidence of anything.
Function WfsServiceRegister
  StrCpy $3 0
  ${Do}
    IntOp $3 $3 + 1
    ; `install` registers with itself as the image path, so it must be run from
    ; the copy, not from $INSTDIR.
    nsExec::ExecToStack '"${WFS_EXE}" install'
    Pop $4
    Pop $5
    nsExec::ExecToStack 'sc.exe query ${WFS_SVC_NAME}'
    Pop $6
    Pop $7
    ${If} $6 == 0
      WriteRegDWORD HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}' 1
      Return
    ${EndIf}
    ${If} $3 >= 5
      DetailPrint 'WFSearch: could not register the service ($4): $5'
      DetailPrint 'WFSearch: whole-disk search stays unavailable until it is -- run "$PROGRAMFILES64\WFSearch\wfs-server.exe" install from an elevated terminal.'
      Return
    ${EndIf}
    Sleep 2000
  ${Loop}
FunctionEnd

Function WfsServiceInstall
  SetRegView 64

  ${IfNot} ${FileExists} '${WFS_SIDECAR}'
    DetailPrint 'WFSearch: sidecar missing from $INSTDIR, skipping service setup'
    Return
  ${EndIf}

  nsExec::ExecToStack 'sc.exe query ${WFS_SVC_NAME}'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ReadRegDWORD $2 HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}'
    ${If} $2 != 1
      DetailPrint 'WFSearch: service belongs to another install, leaving it alone'
      Return
    ${EndIf}
    ; Ours from an earlier SVCode version -- and it is holding its own exe open.
    !insertmacro WfsQuiet 'net stop ${WFS_SVC_NAME}'
  ${EndIf}

  SetOverwrite try
  CreateDirectory '${WFS_DIR}'
  ; CopyFiles takes a destination *directory*, not a destination file name.
  CopyFiles /SILENT /FILESONLY '${WFS_SIDECAR}' '${WFS_DIR}'
  ${IfNot} ${FileExists} '${WFS_EXE}'
    DetailPrint 'WFSearch: could not copy the engine to ${WFS_DIR}'
    Return
  ${EndIf}

  ${If} $0 != 0
    Call WfsServiceRegister
  ${EndIf}

  ; Registration leaves the service stopped on some machines; `install` may
  ; also have started it already, in which case this is a harmless no-op.
  !insertmacro WfsQuiet 'net start ${WFS_SVC_NAME}'
FunctionEnd

Function un.WfsServiceRemove
  SetRegView 64

  ReadRegDWORD $0 HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}'
  ${If} $0 != 1
    Return
  ${EndIf}

  !insertmacro WfsQuiet 'net stop ${WFS_SVC_NAME}'
  ; Written out rather than through WfsQuiet: the path must keep its quotes.
  nsExec::ExecToStack '"${WFS_EXE}" uninstall'
  Pop $0
  Pop $1
  Delete '${WFS_EXE}'
  ; Not /r: if a standalone WFSearch left files here, they are not ours to remove.
  RMDir '${WFS_DIR}'
  DeleteRegValue HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}'
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Call WfsServiceInstall
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Call un.WfsServiceRemove
!macroend
