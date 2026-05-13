param()
$ErrorActionPreference = "Stop"

function Write-Step { param($msg) Write-Host "`n[>] $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "    [X]  $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "         $msg" -ForegroundColor Gray }

Write-Host "  +==================================================+" -ForegroundColor DarkYellow
Write-Host "  |   Rio Gestion WEB - Cloudflare Tunnel Setup      |" -ForegroundColor DarkYellow
Write-Host "  +==================================================+" -ForegroundColor DarkYellow

Write-Step "Verificando cloudflared..."
$cfExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cfExe)) {
    $found = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($found) { $cfExe = $found.Source }
}
if (-not (Test-Path $cfExe)) { Write-Err "cloudflared no encontrado."; exit 1 }
$cfVersion = & $cfExe --version 2>&1
Write-OK "cloudflared encontrado: $cfVersion"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Warn "No estas como Administrador. El servicio no se instalara." }

$tunnelName = Read-Host "Nombre del tunel [rg-tricarios]"
if ([string]::IsNullOrWhiteSpace($tunnelName)) { $tunnelName = "rg-tricarios" }
$localPort = Read-Host "Puerto local RG WEB [3001]"
if ([string]::IsNullOrWhiteSpace($localPort)) { $localPort = "3001" }
$configDir = Join-Path $env:USERPROFILE ".cloudflared"
$certPath = Join-Path $configDir "cert.pem"

Write-Info "Tunel  : $tunnelName"
Write-Info "Puerto : $localPort"
Write-Info "URL    : https://<UUID>.cfargotunnel.com  (se muestra al final)"
$confirm = Read-Host "Continuar? (S/N)"
if ($confirm -notmatch "^[sS]") { exit 0 }

# --- Paso 1: Login ---
Write-Step "Paso 1/4 - Autenticacion en Cloudflare"
if (Test-Path $certPath) {
    Write-OK "Ya autenticado."
} else {
    & $cfExe tunnel login
    if (-not (Test-Path $certPath)) { Write-Err "Login fallido."; exit 1 }
    Write-OK "Autenticado."
}

# --- Paso 2: Crear tunel ---
Write-Step "Paso 2/4 - Creando tunel"
if (& $cfExe tunnel list 2>&1 | Select-String $tunnelName) {
    Write-OK "Tunel ya existe."
} else {
    & $cfExe tunnel create $tunnelName
    if ($LASTEXITCODE -ne 0) { Write-Err "Error creando tunel."; exit 1 }
    Write-OK "Tunel creado."
}

# --- Obtener UUID ---
$tunnelInfo = & $cfExe tunnel info $tunnelName 2>&1
$match = $tunnelInfo | Select-String "([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})" -AllMatches
$tunnelId = $match.Matches[0].Value
if (-not $tunnelId) { Write-Err "No se obtuvo UUID."; exit 1 }
Write-Info "UUID: $tunnelId"
$publicUrl = "https://$tunnelId.cfargotunnel.com"

# --- Paso 3: config.yml ---
Write-Step "Paso 3/4 - Generando config.yml"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$configPath = "$configDir\config.yml"
$yaml = @()
$yaml += "tunnel: $tunnelId"
$yaml += "credentials-file: $configDir\$tunnelId.json"
$yaml += ""
$yaml += "ingress:"
$yaml += "  - service: http://localhost:$localPort"
Set-Content -Path $configPath -Value $yaml -Encoding UTF8
Write-OK "config.yml en $configPath"
foreach ($l in $yaml) { Write-Info $l }

# --- Paso 4: Servicio de Windows ---
Write-Step "Paso 4/4 - Instalando servicio de Windows"
if (-not $isAdmin) {
    Write-Warn "Requiere Admin. Ejecutar manualmente:"
    Write-Info "  cloudflared service install"
    Write-Info "  net start cloudflared"
} else {
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name "cloudflared" -Force -ErrorAction SilentlyContinue
        & $cfExe service uninstall 2>&1 | Out-Null
        Start-Sleep -Seconds 2
    }
    & $cfExe service install
    if ($LASTEXITCODE -ne 0) { Write-Err "Error instalando servicio."; exit 1 }
    Start-Sleep -Seconds 2
    Start-Service -Name "cloudflared"
    Write-OK "Servicio instalado: $((Get-Service cloudflared).Status)"
}

Write-Host ""
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host "  |   Setup completado                               |" -ForegroundColor Green
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host ""
Write-Host "  URL publica fija de RG WEB:" -ForegroundColor White
Write-Host "    $publicUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "  >>> COPIAR ESTA URL <<<" -ForegroundColor Yellow
Write-Host "  $publicUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pasos siguientes:" -ForegroundColor White
Write-Host "  1. En el VPS editar TricariosBack .env:" -ForegroundColor Gray
Write-Host "       RG_API_BASE_URL=$publicUrl" -ForegroundColor Yellow
Write-Host "  2. RG WEB -> Integraciones -> Webhook URL:" -ForegroundColor Gray
Write-Host "       https://tricariosgrowshop.com/api/v1/external/rg/webhook/stock" -ForegroundColor Yellow
Write-Host "  3. VPS: pm2 restart all" -ForegroundColor Gray
Write-Host ""
Write-Host "  Comandos utiles:" -ForegroundColor White
Write-Host "    cloudflared tunnel info $tunnelName" -ForegroundColor Gray
Write-Host "    Get-Service cloudflared" -ForegroundColor Gray
Write-Host ""