# Read-only DELL rollout gates. Dot-sourcing this file performs no inspection.
function Get-CyEndpointPolicy {
    @(
        [pscustomobject]@{
            Service = 'ollama'; Address = '127.0.0.1'; Port = 11434
            Name = 'ollama.exe'
            ExecutablePath = 'C:\dev\inference-runtime\ollama-0.34.1\ollama.exe'
            CommandLine = 'ollama.exe serve'
            Sha256 = '1ff56c8b2c791bff69b6457d25aa63ed11073562cd47b14f42dd16dfa4353e05'
        }
        [pscustomobject]@{
            Service = 'arbiter'; Address = '127.0.0.1'; Port = 11435
            Name = 'node.exe'; ExecutablePath = 'C:\Program Files\nodejs\node.exe'
            CommandLine = 'node.exe /home/user/.local/lib/shared-ollama-arbiter/releases/awg-preempt-1/server.js'
            Sha256 = $null
        }
    )
}

function Assert-CyEndpointOwnership {
    param(
        [AllowEmptyCollection()][object[]]$CimRows,
        [AllowEmptyCollection()][object[]]$NativeListeners,
        [AllowEmptyCollection()][object[]]$Processes,
        [hashtable]$ExecutableHashes
    )
    # NativeListeners MUST originate from TCP_TABLE_OWNER_PID_LISTENER (3),
    # never ALL (5). Listener-table membership, not an anomalous state value,
    # independently establishes that an endpoint is a listener.
    $serverRows = @($CimRows | Where-Object {
        $_.RemotePort -eq 0 -and $_.RemoteAddress -in @('0.0.0.0', '::')
    })
    if (@($NativeListeners | Where-Object LocalPort -eq 11535).Count -ne 0 -or
        @($serverRows | Where-Object LocalPort -eq 11535).Count -ne 0) {
        throw 'Unexpected isolated inference listener'
    }
    foreach ($expected in Get-CyEndpointPolicy) {
        $native = @($NativeListeners | Where-Object LocalPort -eq $expected.Port)
        $cim = @($serverRows | Where-Object LocalPort -eq $expected.Port)
        if ($native.Count -ne 1 -or $cim.Count -ne 1) {
            throw "Expected exactly one native and CIM endpoint for $($expected.Service)"
        }
        if ($native[0].Family -ne 2 -or
            $native[0].LocalAddress -cne $expected.Address -or
            $cim[0].LocalAddress -cne $expected.Address -or
            $null -eq $cim[0].RawState -or $cim[0].RawState -notin @(0, 2) -or
            $native[0].OwningProcess -le 0 -or
            $native[0].OwningProcess -ne $cim[0].OwningProcess) {
            throw "Listener address/state/owner disagreement for $($expected.Service)"
        }
        $owner = @($Processes | Where-Object ProcessId -eq $native[0].OwningProcess)
        if ($owner.Count -ne 1 -or $owner[0].Name -ine $expected.Name -or
            $owner[0].ExecutablePath -ine $expected.ExecutablePath -or
            $owner[0].CommandLine -cne $expected.CommandLine -or
            -not $owner[0].CreationDate) {
            throw "Unexpected or unverifiable process identity for $($expected.Service)"
        }
        # Do not permit a second genuine server even if it owns another port.
        if ($expected.Service -eq 'ollama') {
            $servers = @($Processes | Where-Object {
                $_.Name -ieq 'ollama.exe' -and $_.CommandLine -match '(?i)\bserve\s*$'
            })
        } else {
            $servers = @($Processes | Where-Object {
                $_.Name -ieq 'node.exe' -and $_.CommandLine -match 'shared-ollama-arbiter[/\\].*server\.js'
            })
        }
        if ($servers.Count -ne 1 -or $servers[0].ProcessId -ne $owner[0].ProcessId) {
            throw "Expected one genuine $($expected.Service) server"
        }
        if ($expected.Sha256 -and
            $ExecutableHashes[$expected.ExecutablePath] -ine $expected.Sha256) {
            throw "Executable hash mismatch for $($expected.Service)"
        }
        [pscustomobject]@{
            Service = $expected.Service; LocalAddress = $expected.Address
            LocalPort = $expected.Port; OwningProcess = $owner[0].ProcessId
            ExecutablePath = $owner[0].ExecutablePath; CommandLine = $owner[0].CommandLine
            CreationDate = $owner[0].CreationDate; Sha256 = $expected.Sha256
            CimRawState = $cim[0].RawState; NativeRawState = $native[0].RawState
            ListenerAuthority = 'GetExtendedTcpTable/TCP_TABLE_OWNER_PID_LISTENER'
        }
    }
}

function Assert-CyStableEndpointOwners {
    param([object[]]$Before, [object[]]$After)
    if ($Before.Count -ne 2 -or $After.Count -ne 2) { throw 'Missing endpoint receipt' }
    foreach ($left in $Before) {
        $right = @($After | Where-Object Service -eq $left.Service)
        if ($right.Count -ne 1) { throw 'Missing or duplicated service receipt' }
        foreach ($field in @('LocalAddress', 'LocalPort', 'OwningProcess', 'ExecutablePath', 'CommandLine', 'CreationDate', 'Sha256')) {
            if ($left.$field -cne $right[0].$field) { throw "Endpoint owner changed during health check: $($left.Service)/$field" }
        }
    }
}

function Get-CyNativeListenerRows {
    if (-not ('CyRolloutNativeListeners' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Runtime.InteropServices;
public sealed class CyRolloutListenerRow {
    public int Family, LocalPort, RawState, OwningProcess;
    public string LocalAddress;
}
public static class CyRolloutNativeListeners {
    [DllImport("iphlpapi.dll", SetLastError=true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order,
        int family, int tableClass, uint reserved);
    public static CyRolloutListenerRow[] Read(int family) {
        if (family != 2 && family != 23) throw new ArgumentException("Address family");
        // TCP_TABLE_OWNER_PID_LISTENER, NOT TCP_TABLE_OWNER_PID_ALL.
        const int ListenerTable = 3;
        for (int attempt=0; attempt<3; attempt++) {
            int size=0;
            uint first=GetExtendedTcpTable(IntPtr.Zero, ref size, true, family, ListenerTable, 0);
            if (first!=122 && first!=0) throw new Exception("TCP size query: "+first);
            if (size<4) throw new Exception("Invalid TCP table size");
            int allocated=size;
            IntPtr p=Marshal.AllocHGlobal(allocated);
            try {
                uint result=GetExtendedTcpTable(p, ref size, true, family, ListenerTable, 0);
                if (result==122) continue;
                if (result!=0) throw new Exception("TCP listener query: "+result);
                int count=Marshal.ReadInt32(p), stride=family==2?24:56;
                if (count<0 || (long)count*stride+4>allocated)
                    throw new Exception("Invalid TCP listener table bounds");
                var rows=new List<CyRolloutListenerRow>();
                for (int i=0; i<count; i++) {
                    IntPtr row=IntPtr.Add(p,4+i*stride);
                    int portWord=Marshal.ReadInt32(row,family==2?8:20);
                    int port=((portWord&255)<<8)|((portWord>>8)&255);
                    if (port!=11434 && port!=11435 && port!=11535) continue;
                    string address;
                    if (family==2) address=new IPAddress((long)(uint)Marshal.ReadInt32(row,4)).ToString();
                    else {
                        var bytes=new byte[16]; Marshal.Copy(row,bytes,0,16);
                        address=new IPAddress(bytes).ToString();
                    }
                    rows.Add(new CyRolloutListenerRow {
                        Family=family, LocalAddress=address, LocalPort=port,
                        RawState=Marshal.ReadInt32(row,family==2?0:48),
                        OwningProcess=Marshal.ReadInt32(row,family==2?20:52)
                    });
                }
                return rows.ToArray();
            } finally { Marshal.FreeHGlobal(p); }
        }
        throw new Exception("TCP listener table changed repeatedly");
    }
}
'@
    }
    [CyRolloutNativeListeners]::Read(2)
    [CyRolloutNativeListeners]::Read(23)
}

function Get-CyEndpointSnapshot {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    # Do not filter by rendered State. Preserve the underlying CIM value,
    # including genuine zero, and do not cast absent/null state to zero.
    $cim = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object {
        $_.LocalPort -in @(11434, 11435, 11535)
    } | ForEach-Object {
        [pscustomobject]@{
            LocalAddress = $_.LocalAddress; LocalPort = $_.LocalPort
            RemoteAddress = $_.RemoteAddress; RemotePort = $_.RemotePort
            OwningProcess = $_.OwningProcess; RawState = $_.CimInstanceProperties['State'].Value
        }
    })
    $native = @(Get-CyNativeListenerRows)
    $hashes = @{}
    foreach ($expected in Get-CyEndpointPolicy) {
        if ($expected.Sha256) {
            $hashes[$expected.ExecutablePath] = (Get-FileHash -LiteralPath $expected.ExecutablePath -Algorithm SHA256 -ErrorAction Stop).Hash
        }
    }
    [pscustomobject]@{
        Processes = $processes
        Listeners = @(Assert-CyEndpointOwnership -CimRows $cim -NativeListeners $native -Processes $processes -ExecutableHashes $hashes)
    }
}
