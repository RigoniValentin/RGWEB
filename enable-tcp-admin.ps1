# Enable TCP/IP on SQLEXPRESS via registry and restart service
# Must run as Administrator

# Find the SQL Server instance registry path
$instanceName = 'SQLEXPRESS'
$regPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server"

# Get the instance ID
$instances = Get-ItemProperty "$regPath\Instance Names\SQL" -ErrorAction SilentlyContinue
$instanceId = $instances.$instanceName
Write-Host "Instance ID: $instanceId"

if ($instanceId) {
    # Enable TCP/IP protocol
    $protocolPath = "$regPath\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"
    Write-Host "Registry path: $protocolPath"
    
    $currentValue = Get-ItemProperty $protocolPath -Name 'Enabled' -ErrorAction SilentlyContinue
    Write-Host "TCP Currently Enabled: $($currentValue.Enabled)"
    
    Set-ItemProperty -Path $protocolPath -Name 'Enabled' -Value 1
    Write-Host "TCP/IP Enabled in registry"

    # Set static port 1433 on IPAll
    $ipAllPath = "$protocolPath\IPAll"
    Set-ItemProperty -Path $ipAllPath -Name 'TcpPort' -Value '1433'
    Set-ItemProperty -Path $ipAllPath -Name 'TcpDynamicPorts' -Value ''
    Write-Host "Port set to 1433 on IPAll"

    # Restart SQL Server
    Write-Host "Restarting SQL Server..."
    net stop "MSSQL`$SQLEXPRESS" /y 2>$null
    Start-Sleep 2
    net start "MSSQL`$SQLEXPRESS"
    Start-Sleep 3
    Write-Host "SQL Server restarted"
} else {
    Write-Host "ERROR: Could not find SQLEXPRESS instance in registry"
    # List what instances exist
    Get-ItemProperty "$regPath\Instance Names\SQL" | Format-List
}
