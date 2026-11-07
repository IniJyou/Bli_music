!macro customInstall
  !ifdef APP_INSTALLER_STORE_FILE
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  !endif
!macroend
