Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root 'mobile\resources'
New-Item -ItemType Directory -Force -Path $resources | Out-Null

function Draw-Tick([System.Drawing.Graphics]$g, [int]$cx, [int]$cy, [int]$size, [string]$circleColor, [string]$checkColor) {
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($circleColor))
  $g.FillEllipse($brush, $cx - $size / 2, $cy - $size / 2, $size, $size)
  $width = [Math]::Max(3, [int]($size / 9))
  $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($checkColor), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF([float]($cx - $size * 0.22), [float]($cy + $size * 0.02))),
    (New-Object System.Drawing.PointF([float]($cx - $size * 0.06), [float]($cy + $size * 0.18))),
    (New-Object System.Drawing.PointF([float]($cx + $size * 0.24), [float]($cy - $size * 0.16)))
  )
  $g.DrawLines($pen, $points)
  $pen.Dispose()
  $brush.Dispose()
}

# 1024 app icon
$icon = New-Object System.Drawing.Bitmap 1024, 1024
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
Draw-Tick $g 512 512 1000 '#f5c542' '#17181a'
$icon.Save((Join-Path $resources 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$icon.Dispose()

# 2732 splash with app name
$splash = New-Object System.Drawing.Bitmap 2732, 2732
$g = [System.Drawing.Graphics]::FromImage($splash)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.ColorTranslator]::FromHtml('#1b1c1f'))
Draw-Tick $g 1366 1230 620 '#f5c542' '#17181a'

$name = -join ([char[]](0x523B, 0x5EA6, 0x6E05, 0x5355))
$font = New-Object System.Drawing.Font('Microsoft YaHei', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e8eaed'))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 1680, 2732, 220)
$g.DrawString($name, $font, $textBrush, $rect, $format)
$splash.Save((Join-Path $resources 'splash.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$format.Dispose()
$textBrush.Dispose()
$font.Dispose()
$g.Dispose()
$splash.Dispose()

Write-Output "mobile assets written to $resources"
