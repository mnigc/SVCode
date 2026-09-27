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

; There is deliberately no `run this command quietly` macro here. NSIS eats the
; quotes around a command string when it arrives as a macro parameter, so
; `nsExec::ExecToLog 'net start WFSearch'` compiles into a call that runs bare
; `net` -- which prints its usage text and returns 1. Same for a path:
; `"C:\Program Files\x.exe" install` reaches nsExec unquoted and launches
; `C:\Program`. Both variants failed silently here, and the second one is what
; made the first release of this hook skip service registration on every
; machine that installed into Program Files. Every command is written out in
; full at its call site instead.

; Registers the service. The engine stopped installing itself in 0.1.2
; (`install` / `uninstall` are gone -- see its docs/deploy.md): a service only
; ever sees the one string in its binPath, and where that points is the
; deployer's decision.
;
; binPath has to carry the exe path *and* the `run` entry point, so its value
; contains an inner pair of quotes -- escaped with backslashes, which is how
; sc.exe is told to strip exactly one layer:
;   binPath= "\"C:\Program Files\WFSearch\wfs-server.exe\" run"
;
; Ownership is claimed only once the SCM really has the service: `sc create`'s
; exit code would not prove it, and an unowned service is worse than none.
Function WfsServiceRegister
  StrCpy $3 0
  ${Do}
    IntOp $3 $3 + 1
    nsExec::ExecToStack 'sc.exe create ${WFS_SVC_NAME} binPath= "\"${WFS_EXE}\" run" obj= LocalSystem start= auto DisplayName= "WFSearch File Search Engine"'
    Pop $4
    Pop $5
    nsExec::ExecToStack 'sc.exe query ${WFS_SVC_NAME}'
    Pop $6
    Pop $7
    ${If} $6 == 0
      ; Cosmetic, so it is set after the service is already ours and never
      ; gates ownership: a bare skeleton service still beats no service.
      nsExec::ExecToStack 'sc.exe description ${WFS_SVC_NAME} "Fast NTFS filename search engine (MFT index + USN journal) for SVCode whole-disk search. Reading the MFT requires LocalSystem rights."'
      Pop $9
      Pop $9
      WriteRegDWORD HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}' 1
      Return
    ${EndIf}
    ${If} $3 >= 5
      DetailPrint 'WFSearch: could not register the service ($4): $5'
      DetailPrint 'WFSearch: whole-disk search stays unavailable until it is -- from an elevated terminal run: sc create WFSearch binPath= "\"$PROGRAMFILES64\WFSearch\wfs-server.exe\" run" obj= LocalSystem start= auto'
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
    nsExec::ExecToLog 'net stop ${WFS_SVC_NAME}'
    Pop $9
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

  ; The engine exits when 127.0.0.1:15100 is already taken, and the process
  ; that usually holds it is the plain-user sidecar an older SVCode spawned --
  ; one that can bind the port but cannot read an MFT. The service is stopped
  ; at this point (or does not exist yet), so this only ever removes the
  ; impostor; SVCode itself is untouched, and it stops trying for the port once
  ; it sees the service registered.
  ;
  ; Bare `taskkill`, never '$SYSDIR\System32\taskkill.exe': this is a 32-bit
  ; installer, so the loader redirects System32 to SysWOW64 -- which has no
  ; taskkill.exe -- and nsExec then reports a bare `error`.
  nsExec::ExecToLog 'taskkill /F /IM wfs-server.exe'
  Pop $9

  ; The service is stopped on both paths that reach here -- ours from an
  ; earlier SVCode version, or the one just created -- so this is the start
  ; that brings the engine up without waiting for a reboot.
  nsExec::ExecToLog 'net start ${WFS_SVC_NAME}'
  Pop $9
FunctionEnd

Function un.WfsServiceRemove
  SetRegView 64

  ReadRegDWORD $0 HKLM '${WFS_MARK_KEY}' '${WFS_MARK_VALUE}'
  ${If} $0 != 1
    Return
  ${EndIf}

  nsExec::ExecToLog 'net stop ${WFS_SVC_NAME}'
  Pop $9
  ; The engine cannot uninstall itself any more either, so the SCM call is
  ; ours. The service is stopped by now, which is when it releases its exe.
  nsExec::ExecToStack 'sc.exe delete ${WFS_SVC_NAME}'
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
