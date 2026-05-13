# =============================================================================
#  Río Gestión WEB — Setup Túnel Cloudflare Permanente
#
#  Crea un túnel nombrado que expone http://localhost:3001 de forma estable
#  bajo un subdominio de Cloudflare y lo instala como servicio de Windows.
#
#  Requisitos previos:
#    - cloudflared.exe instalado (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
#    - El dominio configurado en Cloudflare (nameservers apuntando a CF)
#    - Correr como Administrador para instalar el servicio
#
#  Uso:
#    1. Abrir PowerShell como Administrador
#    2. .\setup-cloudflare-tunnel.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

# ── Colores ──────────────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n[>] $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "    [X]  $msg" -ForegroundColor Red }
function Write-Info  { param($msg) Write-Host "         $msg" -ForegroundColor Gray }

# ── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor DarkYellow
Write-Host "  ║   Río Gestión WEB — Cloudflare Tunnel Setup      ║" -ForegroundColor DarkYellow
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor DarkYellow
Write-Host ""

# ── Verificar cloudflared ────────────────────────────────────────────────────
Write-Step "Verificando cloudflared..."
$cfExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cfExe)) {
    $cfExe = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
}
if (-not $cfExe -or -not (Test-Path $cfExe)) {
    Write-Err "cloudflared no encontrado."
    Write-Info "Descargarlo desde: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
    exit 1
}
$cfVersion = & $cfExe --version 2>&1
Write-OK "cloudflared encontrado: $cfVersion"

# ── Verificar Administrador ──────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "No estás corriendo como Administrador."
    Write-Info "El paso de instalación del servicio fallará. Re-ejecutar como Admin si es necesario."
}

# ── Parámetros de configuración ──────────────────────────────────────────────
Write-Host ""
Write-Host "  Configuración del túnel:" -ForegroundColor White
Write-Host ""

$defaultTunnelName   = "rg-tricarios"
$defaultHostname     = "gestion.tricariosgrowshop.com"
$defaultLocalPort    = "3001"
$defaultConfigDir    = "$env:USERPROFILE\.cloudflared"

$tunnelName = Read-Host "  Nombre del túnel [$defaultTunnelName]"
if ([string]::IsNullOrWhiteSpace($tunnelName)) { $tunnelName = $defaultTunnelName }

$hostname = Read-Host "  Subdominio Cloudflare [$defaultHostname]"
if ([string]::IsNullOrWhiteSpace($hostname)) { $hostname = $defaultHostname }

$localPort = Read-Host "  Puerto local de RG WEB [$defaultLocalPort]"
if ([string]::IsNullOrWhiteSpace($localPort)) { $localPort = $defaultLocalPort }

$configDir = $defaultConfigDir

Write-Host ""
Write-Host "  Resumen:" -ForegroundColor White
Write-Info "  Túnel   : $tunnelName"
Write-Info "  Dominio : $hostname"
Write-Info "  Local   : http://localhost:$localPort"
Write-Info "  Config  : $configDir"
Write-Host ""
$confirm = Read-Host "  ¿Continuar? (S/N)"
if ($confirm -notmatch "^[sS]") { Write-Host "  Cancelado." -ForegroundColor Yellow; exit 0 }

# ── Paso 1: Login en Cloudflare ───────────────────────────────────────────────
Write-Step "Paso 1/5 — Autenticación en Cloudflare"
$certPath = "$configDir\cert.pem"
if (Test-Path $certPath) {
    Write-OK "Ya autenticado (cert.pem existe). Saltando login."
} else {
    Write-Info "Se abrirá el navegador. Iniciá sesión y seleccioná el dominio '$($hostname.Split('.')[-2..-1] -join '.')'."
    Write-Info "Presioná Enter cuando el navegador haya completado la autorización..."
    & $cfExe tunnel login
    if (-not (Test-Path $certPath)) {
        Write-Err "No se generó cert.pem. Verificar que completaste el login en el navegador."
        exit 1
    }
    Write-OK "Autenticación exitosa."
}

# ── Paso 2: Crear túnel (si no existe) ────────────────────────────────────────
Write-Step "Paso 2/5 — Creando túnel '$tunnelName'"
$existingTunnel = & $cfExe tunnel list 2>&1 | Select-String $tunnelName
if ($existingTunnel) {
    Write-OK "El túnel '$tunnelName' ya existe. Saltando creación."
} else {
    & $cfExe tunnel create $tunnelName
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Error al crear el túnel."
        exit 1
    }
    Write-OK "Túnel creado."
}

# Obtener el UUID del túnel
$tunnelInfo = & $cfExe tunnel info $tunnelName 2>&1
$tunnelId = ($tunnelInfo | Select-String "([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})" -AllMatches).Matches[0].Value
if (-not $tunnelId) {
    Write-Err "No se pudo obtener el UUID del túnel."
    Write-Info "Ejecutar manualmente: cloudflared tunnel info $tunnelName"
    exit 1
}
Write-Info "UUID del túnel: $tunnelId"

# ── Paso 3: Crear config.yml ──────────────────────────────────────────────────
Write-Step "Paso 3/5 — Generando archivo de configuración"
$configPath = "$configDir\config.yml"

$configContent = @"
tunnel: $tunnelId
credentials-file: $configDir\$tunnelId.json

ingress:
  - hostname: $hostname
    service: http://localhost:$localPort
  - service: http_status:404
"@

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Set-Content -Path $configPath -Value $configContent -Encoding UTF8
Write-OK "config.yml generado en: $configPath"
Write-Info ""
Write-Info $configContent

# ── Paso 4: Ruteo DNS ─────────────────────────────────────────────────────────
Write-Step "Paso 4/5 — Configurando registro DNS en Cloudflare"
Write-Info "Esto crea un CNAME '$hostname' → '$tunnelId.cfargotunnel.com' en tu zona de Cloudflare."
& $cfExe tunnel route dns $tunnelName $hostname
if ($LASTEXITCODE -ne 0) {
    Write-Warn "El ruteo DNS puede haber fallado (quizás el CNAME ya existe, lo cual está bien)."
    Write-Info "Verificar en https://dash.cloudflare.com → DNS que existe el CNAME."
} else {
    Write-OK "CNAME creado en Cloudflare."
}

# ── Paso 5: Instalar servicio de Windows ──────────────────────────────────────
Write-Step "Paso 5/5 — Instalando servicio de Windows"
if (-not $isAdmin) {
    Write-Warn "Saltando instalación del servicio (requiere Administrador)."
    Write-Info "Correr como Admin y ejecutar:"
    Write-Info "  cloudflared service install"
    Write-Info "  net start cloudflared"
} else {
    # Detener servicio previo si existe
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Info "Servicio ya existe. Deteniéndolo para reinstalar..."
        Stop-Service -Name "cloudflared" -Force -ErrorAction SilentlyContinue
        & $cfExe service uninstall 2>&1 | Out-Null
        Start-Sleep -Seconds 2
    }
    & $cfExe service install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Error al instalar el servicio."
        exit 1
    }
    Start-Sleep -Seconds 2
    Start-Service -Name "cloudflared"
    $svcStatus = (Get-Service -Name "cloudflared").Status
    Write-OK "Servicio instalado y estado: $svcStatus"
}

# ── Resumen final ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Setup completado                               ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  URL pública de RG WEB:" -ForegroundColor White
Write-Host "    https://$hostname" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Próximos pasos:" -ForegroundColor White
Write-Host "  1. En TricariosBack .env, actualizar:" -ForegroundColor Gray
Write-Host "       RG_API_BASE_URL=https://$hostname" -ForegroundColor Yellow
Write-Host "  2. En RG WEB → Configuración → Integraciones → Webhook URL:" -ForegroundColor Gray
Write-Host "       https://tricariosgrowshop.com/api/v1/external/rg/webhook/stock" -ForegroundColor Yellow
Write-Host "  3. Reiniciar TricariosBack en el VPS (pm2 restart all)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Comandos útiles:" -ForegroundColor White
Write-Host "    Ver estado:   cloudflared tunnel info $tunnelName" -ForegroundColor Gray
Write-Host "    Ver logs:     cloudflared tunnel logs $tunnelName" -ForegroundColor Gray
Write-Host "    Servicio:     Get-Service cloudflared" -ForegroundColor Gray
Write-Host ""
