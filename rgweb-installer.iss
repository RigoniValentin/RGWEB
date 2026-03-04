; ═══════════════════════════════════════════════════════════
;   Río Gestión WEB — Inno Setup Installer Script
; ═══════════════════════════════════════════════════════════
; Requirements:
;   1. Run build.bat first to generate "Rio Gestion WEB" folder
;   2. Compile this .iss with Inno Setup Compiler
;      (https://jrsoftware.org/isinfo.php)
;
; Structure expected in Rio Gestion WEB/:
;   RGWeb.exe
;   RGWeb-hidden.vbs
;   public/
; ═══════════════════════════════════════════════════════════

#define MyAppName "Río Gestión WEB"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Río Gestión"
#define MyAppExeName "RGWeb.exe"
#define MyAppURL "https://github.com/RigoniValentin/RGWEB"

[Setup]
AppId={{B4E7F8D2-3A1C-4D5E-9F0B-6C8D2E4F1A3B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\RioGestionWEB
DefaultGroupName={#MyAppName}
OutputDir=Rio Gestion WEB\output
OutputBaseFilename=RGWeb_Setup_{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
; Uncomment and provide path to your icon:
; SetupIconFile=frontend\src\assets\logos\RioGestionWhite.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el &Escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked
Name: "startupicon"; Description: "Iniciar con Windows"; GroupDescription: "Opciones adicionales:"; Flags: unchecked
Name: "firewall"; Description: "Agregar regla de Firewall (puerto 3001)"; GroupDescription: "Opciones adicionales:"; Flags: unchecked
Name: "enabletcp"; Description: "Habilitar TCP/IP en SQL Server (necesario si usa SQLEXPRESS)"; GroupDescription: "Opciones adicionales:"; Flags: unchecked

[Files]
; Main executable
Source: "Rio Gestion WEB\RGWeb.exe"; DestDir: "{app}"; Flags: ignoreversion

; Hidden launcher (runs without console window)
Source: "Rio Gestion WEB\RGWeb-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

; Frontend files
Source: "Rio Gestion WEB\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; TCP enabler script
Source: "Rio Gestion WEB\enable-tcp-admin.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\RGWeb-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\RGWeb-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Open browser after install
Filename: "wscript.exe"; Parameters: """{app}\RGWeb-hidden.vbs"""; Description: "Iniciar {#MyAppName}"; Flags: nowait postinstall skipifsilent
Filename: "http://localhost:3001"; Description: "Abrir en navegador"; Flags: shellexec nowait postinstall skipifsilent unchecked

; Firewall rule (optional task)
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""Rio Gestion WEB"" dir=in action=allow protocol=TCP localport=3001"; Flags: runhidden; Tasks: firewall

; Enable TCP/IP on SQLEXPRESS (optional task)
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\enable-tcp-admin.ps1"""; Flags: runhidden; Tasks: enabletcp

[UninstallRun]
; Remove firewall rule on uninstall
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Rio Gestion WEB"""; Flags: runhidden

[Registry]
; Auto-start with Windows (optional task)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "RioGestionWEB"; ValueData: "wscript.exe ""{app}\RGWeb-hidden.vbs"""; Flags: uninsdeletevalue; Tasks: startupicon

[Code]
// Show a reminder about appdata.ini after installation
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not FileExists(ExpandConstant('{app}\appdata.ini')) then
    begin
      MsgBox(
        'IMPORTANTE: Debe copiar el archivo "appdata.ini" en la carpeta de instalación ' +
        'para que el sistema pueda conectarse a la base de datos.' + #13#10 + #13#10 +
        'Carpeta: ' + ExpandConstant('{app}'),
        mbInformation, MB_OK
      );
    end;
  end;
end;
