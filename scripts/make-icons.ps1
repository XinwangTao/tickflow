Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root 'resources'
New-Item -ItemType Directory -Force -Path $resources | Out-Null

function New-TickFlowIcon([int]$Size, [string]$Path) {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#f5c542'))
  $g.FillEllipse($brush, 1, 1, $Size - 2, $Size - 2)

  $width = [Math]::Max(2, [int]($Size / 9))
  $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#17181a'), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $points = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF([float]($Size * 0.28), [float]($Size * 0.52))),
    (New-Object System.Drawing.PointF([float]($Size * 0.44), [float]($Size * 0.68))),
    (New-Object System.Drawing.PointF([float]($Size * 0.74), [float]($Size * 0.34)))
  )
  $g.DrawLines($pen, $points)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $pen.Dispose()
  $brush.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

New-TickFlowIcon 32 (Join-Path $resources 'tray.png')
New-TickFlowIcon 256 (Join-Path $resources 'icon.png')
Write-Output "icons written to $resources"
