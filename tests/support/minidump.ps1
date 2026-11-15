# Writes a full memory dump of a process with dbghelp's MiniDumpWriteDump,
# which suspends the process while it writes.
param([int]$ProcessId, [string]$Path)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class Minidump {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);

  [DllImport("dbghelp.dll", SetLastError = true)]
  public static extern bool MiniDumpWriteDump(IntPtr process, int pid,
    SafeFileHandle file, uint type, IntPtr exception, IntPtr user,
    IntPtr callback);
}
'@

# PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
$process = [Minidump]::OpenProcess(0x0410, $false, $ProcessId)
if ($process -eq [IntPtr]::Zero) {
  throw "OpenProcess failed: $([ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
}
$file = [IO.File]::Create($Path)
try {
  # MiniDumpWithFullMemory
  if (-not [Minidump]::MiniDumpWriteDump($process, $ProcessId,
      $file.SafeFileHandle, 2, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw "MiniDumpWriteDump failed: 0x$('{0:X8}' -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
} finally {
  $file.Dispose()
  [void][Minidump]::CloseHandle($process)
}
