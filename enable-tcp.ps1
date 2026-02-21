# Enable TCP/IP on SQLEXPRESS
Import-Module SQLPS -DisableNameChecking
$compName = $env:COMPUTERNAME
$wmi = New-Object 'Microsoft.SqlServer.Management.Smo.Wmi.ManagedComputer' '.'
$uri = "ManagedComputer[@Name='$compName']/ServerInstance[@Name='SQLEXPRESS']/ServerProtocol[@Name='Tcp']"
$tcp = $wmi.GetSmoObject($uri)
Write-Host "TCP/IP Currently Enabled: $($tcp.IsEnabled)"
$tcp.IsEnabled = $true
$tcp.Alter()
Write-Host "TCP/IP Enabled: $($tcp.IsEnabled)"

# Set TCP port to 1433
$ipAll = $tcp.IPAddresses | Where-Object { $_.Name -eq 'IPAll' }
if ($ipAll) {
    $port = $ipAll.IPAddressProperties | Where-Object { $_.Name -eq 'TcpPort' }
    $dynPort = $ipAll.IPAddressProperties | Where-Object { $_.Name -eq 'TcpDynamicPorts' }
    if ($dynPort) { $dynPort.Value = '' }
    if ($port) { $port.Value = '1433' }
    $tcp.Alter()
    Write-Host "TCP Port set to 1433"
}

# Restart SQL Server service
Write-Host "Restarting SQLEXPRESS service..."
Restart-Service -Name 'MSSQL$SQLEXPRESS' -Force
Write-Host "SQLEXPRESS restarted successfully"
