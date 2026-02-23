# ═══════════════════════════════════════════════════════════
#   Río Gestión WEB — Habilitar TCP/IP en SQL Server
# ═══════════════════════════════════════════════════════════
# Este script habilita TCP/IP en SQLEXPRESS, fija el puerto
# 1433 y reinicia el servicio. Se auto-eleva a Administrador.
# ═══════════════════════════════════════════════════════════

# ── Auto-elevate to Administrator if not already ──────────
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Solicitando permisos de Administrador..." -ForegroundColor Yellow
    Start-Process powershell.exe "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Rio Gestion WEB - Habilitar TCP/IP en SQL Server" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$success = $true

# ── Find SQL Server instance ─────────────────────────────
$instanceName = 'SQLEXPRESS'
$regPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server"

$instances = Get-ItemProperty "$regPath\Instance Names\SQL" -ErrorAction SilentlyContinue
$instanceId = $instances.$instanceName

if (-not $instanceId) {
    Write-Host "  ERROR: No se encontro la instancia SQLEXPRESS en el registro." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Instancias encontradas:" -ForegroundColor Yellow
    Get-ItemProperty "$regPath\Instance Names\SQL" -ErrorAction SilentlyContinue | Format-List
    $success = $false
} else {
    Write-Host "  Instancia encontrada: $instanceId" -ForegroundColor Green

    try {
        # ── Enable TCP/IP protocol ───────────────────────────
        $protocolPath = "$regPath\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"
        
        $currentValue = Get-ItemProperty $protocolPath -Name 'Enabled' -ErrorAction SilentlyContinue
        if ($currentValue.Enabled -eq 1) {
            Write-Host "  TCP/IP ya estaba habilitado." -ForegroundColor Green
        } else {
            Set-ItemProperty -Path $protocolPath -Name 'Enabled' -Value 1
            Write-Host "  TCP/IP habilitado correctamente." -ForegroundColor Green
        }

        # ── Set static port 1433 on IPAll ────────────────────
        $ipAllPath = "$protocolPath\IPAll"
        Set-ItemProperty -Path $ipAllPath -Name 'TcpPort' -Value '1433'
        Set-ItemProperty -Path $ipAllPath -Name 'TcpDynamicPorts' -Value ''
        Write-Host "  Puerto fijado en 1433." -ForegroundColor Green

        # ── Restart SQL Server service ───────────────────────
        Write-Host ""
        Write-Host "  Reiniciando SQL Server..." -ForegroundColor Yellow
        net stop "MSSQL`$SQLEXPRESS" /y 2>$null | Out-Null
        Start-Sleep 2
        net start "MSSQL`$SQLEXPRESS" 2>$null | Out-Null
        Start-Sleep 3
        
        # Verify service is running
        $svc = Get-Service "MSSQL`$SQLEXPRESS" -ErrorAction SilentlyContinue
        if ($svc.Status -eq 'Running') {
            Write-Host "  SQL Server reiniciado correctamente." -ForegroundColor Green
        } else {
            Write-Host "  ADVERTENCIA: El servicio no parece estar corriendo (estado: $($svc.Status))." -ForegroundColor Yellow
            $success = $false
        }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $success = $false
    }
}

# ── Result ────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
if ($success) {
    Write-Host "  LISTO! TCP/IP habilitado. Ya puede iniciar RG WEB." -ForegroundColor Green
} else {
    Write-Host "  Hubo problemas. Revise los mensajes de arriba." -ForegroundColor Red
}
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Presione una tecla para cerrar..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
