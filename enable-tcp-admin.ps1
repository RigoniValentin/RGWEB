# enable-tcp-admin.ps1
# Habilita el protocolo TCP/IP en SQL Server (SQLEXPRESS / MSSQLSERVER)
# Se ejecuta con privilegios de administrador desde el instalador Inno Setup.

$instances = @('MSSQLSERVER', 'SQLEXPRESS')
$versions  = @(16, 15, 14, 13, 12, 11)
$changed   = $false

foreach ($inst in $instances) {
    foreach ($ver in $versions) {
        $ns = "root\Microsoft\SqlServer\ComputerManagement$ver"
        try {
            $prot = Get-WmiObject -Namespace $ns -Class ServerProtocols `
                        -Filter "InstanceName='$inst' AND ProtocolName='Tcp'" `
                        -ErrorAction Stop
            if ($null -ne $prot) {
                if (-not $prot.Enabled) {
                    $prot.Enabled = $true
                    $prot.Put() | Out-Null
                    Write-Host "TCP/IP habilitado para instancia '$inst' (SQL Server v$ver)."
                    $svcName = if ($inst -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$inst" }
                    try {
                        Stop-Service  $svcName -Force        -ErrorAction Stop
                        Start-Service $svcName               -ErrorAction Stop
                        Write-Host "Servicio '$svcName' reiniciado."
                    } catch {
                        Write-Warning "No se pudo reiniciar '$svcName': $_"
                    }
                    $changed = $true
                } else {
                    Write-Host "TCP/IP ya estaba habilitado para '$inst' (v$ver)."
                    $changed = $true
                }
                break   # versión encontrada, no seguir buscando para esta instancia
            }
        } catch { <# namespace no existe para esta versión, continuar #> }
    }
}

if (-not $changed) {
    Write-Warning "No se encontró ninguna instancia de SQL Server compatible."
    Write-Warning "Habilite TCP/IP manualmente con SQL Server Configuration Manager."
}
