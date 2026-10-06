Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QqWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@
$null = [QqWindowCapture]::SetProcessDPIAware()
$qqTarget = Get-Process -Id 36204
if ($qqTarget.ProcessName -ne 'QQ' -or $qqTarget.MainWindowHandle -eq 0) { throw 'Original QQ window not available' }
if ([QqWindowCapture]::IsIconic($qqTarget.MainWindowHandle)) { $null = [QqWindowCapture]::ShowWindow($qqTarget.MainWindowHandle, 9); Start-Sleep -Milliseconds 400 }
$qqRect = New-Object QqWindowCapture+RECT
if (-not [QqWindowCapture]::GetWindowRect($qqTarget.MainWindowHandle, [ref]$qqRect)) { throw 'GetWindowRect failed' }
$qqBitmap = New-Object System.Drawing.Bitmap(($qqRect.Right-$qqRect.Left), ($qqRect.Bottom-$qqRect.Top))
$qqGraphics = [System.Drawing.Graphics]::FromImage($qqBitmap)
$qqDc = $qqGraphics.GetHdc()
try { $qqCaptured = [QqWindowCapture]::PrintWindow($qqTarget.MainWindowHandle, $qqDc, 2) } finally { $qqGraphics.ReleaseHdc($qqDc) }
try {
 if (-not $qqCaptured) { throw 'PrintWindow failed' }
 $qqImagePath = Join-Path $PSScriptRoot 'qq-window-current.png'
 $qqBitmap.Save($qqImagePath, [System.Drawing.Imaging.ImageFormat]::Png)
 [pscustomobject]@{path=$qqImagePath;width=$qqBitmap.Width;height=$qqBitmap.Height} | ConvertTo-Json -Compress
} finally { $qqGraphics.Dispose(); $qqBitmap.Dispose() }
