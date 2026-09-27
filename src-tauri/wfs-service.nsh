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
!macro WfsQuiet cmd
  nsExec::ExecToLog ${cmd}
  Pop $9
!macroend

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
    ; `install` registers with itself as the image path, so it must be run from
    ; the copy, not from $INSTDIR.
    !insertmacro WfsQuiet '"${WFS_EXE}" install'
    WriteRegDWORD HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}' 1
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
  !insertmacro WfsQuiet '"${WFS_EXE}" uninstall'
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
