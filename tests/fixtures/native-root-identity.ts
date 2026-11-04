import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Use the same Win32 identity fields as win-handles.c, independently of Node/libuv.
// The path is passed in an environment variable, never interpolated into PowerShell or C#.
const oracleScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class PraxisRootIdentityOracle {
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation {
        public uint Attributes;
        public FileTime CreationTime;
        public FileTime LastAccessTime;
        public FileTime LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle OpenDirectory(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);

    public static string Read(string path) {
        // READ_ATTRIBUTES, share read/write, OPEN_EXISTING, BACKUP_SEMANTICS | OPEN_REPARSE_POINT.
        using (SafeFileHandle handle = OpenDirectory(path, 0x80, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new InvalidOperationException("Directory open failed");
            FileInformation info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new InvalidOperationException("Directory identity query failed");
            ulong index = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;
            return info.VolumeSerialNumber.ToString(CultureInfo.InvariantCulture) + ":" +
                index.ToString(CultureInfo.InvariantCulture);
        }
    }
}
'@
[PraxisRootIdentityOracle]::Read($env:PRAXIS_IDENTITY_ORACLE_ROOT)
`;

export async function windowsDirectoryIdentity(directory: string): Promise<string> {
  let output: string;
  try {
    const result = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(oracleScript, 'utf16le').toString('base64'),
      ],
      {
        env: { ...process.env, PRAXIS_IDENTITY_ORACLE_ROOT: directory },
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
      },
    );
    output = result.stdout.trim();
  } catch {
    // Child-process errors include command lines and stderr; do not surface either in CI.
    throw new Error('Windows directory identity oracle failed.');
  }
  if (!/^\d+:\d+$/.test(output))
    throw new Error('Windows directory identity oracle returned invalid IDs.');
  return output;
}
