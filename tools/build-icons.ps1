[CmdletBinding()]
param(
    [switch]$IncludeLogo400
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src'))
$svgPath = Join-Path $sourceDirectory 'icon.svg'
[xml]$svg = Get-Content -LiteralPath $svgPath -Raw
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$viewBox = @($svg.DocumentElement.GetAttribute('viewBox') -split '\s+' | ForEach-Object {
    [single]::Parse($_, $culture)
})
if ($viewBox.Count -ne 4 -or $viewBox[0] -ne 0 -or $viewBox[1] -ne 0 -or
    $viewBox[2] -ne $viewBox[3] -or $viewBox[2] -le 0) {
    throw 'Expected a square SVG viewBox starting at 0,0.'
}

function Get-SvgNumber {
    param([System.Xml.XmlElement]$Element, [string]$Name)
    return [single]::Parse($Element.GetAttribute($Name), $culture)
}

function Draw-Logo {
    param([System.Drawing.Graphics]$Graphics)

    # Render the SVG's small, explicit shape vocabulary; SVG owns all geometry/colors.
    foreach ($element in $svg.DocumentElement.ChildNodes) {
        if ($element -isnot [System.Xml.XmlElement]) { continue }
        switch ($element.LocalName) {
            { $_ -in 'title', 'desc' } { continue }
            'rect' {
                $brush = [System.Drawing.SolidBrush]::new(
                    [System.Drawing.ColorTranslator]::FromHtml($element.GetAttribute('fill')))
                try {
                    $Graphics.FillRectangle($brush,
                        (Get-SvgNumber $element 'x'), (Get-SvgNumber $element 'y'),
                        (Get-SvgNumber $element 'width'), (Get-SvgNumber $element 'height'))
                }
                finally { $brush.Dispose() }
            }
            'circle' {
                $brush = [System.Drawing.SolidBrush]::new(
                    [System.Drawing.ColorTranslator]::FromHtml($element.GetAttribute('fill')))
                try {
                    $radius = Get-SvgNumber $element 'r'
                    $Graphics.FillEllipse($brush,
                        ((Get-SvgNumber $element 'cx') - $radius),
                        ((Get-SvgNumber $element 'cy') - $radius),
                        (2 * $radius), (2 * $radius))
                }
                finally { $brush.Dispose() }
            }
            'polyline' {
                if ($element.GetAttribute('fill') -ne 'none' -or
                    $element.GetAttribute('stroke-linecap') -ne 'round' -or
                    $element.GetAttribute('stroke-linejoin') -ne 'round') {
                    throw 'Polyline renderer requires no fill and round caps/joins.'
                }
                [System.Drawing.PointF[]]$points = @(
                    foreach ($pair in ($element.GetAttribute('points').Trim() -split '\s+')) {
                        $coordinates = $pair -split ','
                        [System.Drawing.PointF]::new(
                            [single]::Parse($coordinates[0], $culture),
                            [single]::Parse($coordinates[1], $culture))
                    }
                )
                $pen = [System.Drawing.Pen]::new(
                    [System.Drawing.ColorTranslator]::FromHtml($element.GetAttribute('stroke')),
                    (Get-SvgNumber $element 'stroke-width'))
                try {
                    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
                    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
                    $Graphics.DrawLines($pen, $points)
                }
                finally { $pen.Dispose() }
            }
            default { throw "Unsupported SVG element: $($element.LocalName)" }
        }
    }
}

function Export-Logo {
    param([string]$FileName, [int]$Size)

    # Fixed 4x supersampling provides smooth edges without fonts or dependencies.
    $renderSize = $Size * 4
    $render = [System.Drawing.Bitmap]::new($renderSize, $renderSize,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($render)
        try {
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scale = [single]($renderSize / $viewBox[2])
            $graphics.ScaleTransform($scale, $scale)
            Draw-Logo $graphics
        }
        finally { $graphics.Dispose() }

        $output = [System.Drawing.Bitmap]::new($Size, $Size,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $output.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
            try {
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
                $graphics.DrawImage($render, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
                    0, 0, $renderSize, $renderSize, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
            }
            finally {
                $attributes.Dispose()
                $graphics.Dispose()
            }
            $outputPath = Join-Path $sourceDirectory $FileName
            $output.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $output.Dispose() }
    }
    finally { $render.Dispose() }

    # Reopen the saved asset so validation covers the actual encoded PNG.
    $check = [System.Drawing.Bitmap]::new($outputPath)
    try {
        if ($check.Width -ne $Size -or $check.Height -ne $Size) {
            throw "Incorrect dimensions: $outputPath"
        }
        $navy = [System.Drawing.ColorTranslator]::FromHtml('#102331').ToArgb()
        $foregroundPixels = 0
        for ($y = 0; $y -lt $Size; $y++) {
            for ($x = 0; $x -lt $Size; $x++) {
                $pixel = $check.GetPixel($x, $y)
                if ($pixel.A -ne 255) { throw "Unexpected transparent pixel: $outputPath" }
                if ($pixel.ToArgb() -ne $navy) { $foregroundPixels++ }
            }
        }
        if ($foregroundPixels -lt ($Size * $Size * 0.1) -or
            $foregroundPixels -gt ($Size * $Size * 0.5) -or
            $check.GetPixel(0, 0).ToArgb() -ne $navy -or
            $check.GetPixel(($Size - 1), ($Size - 1)).ToArgb() -ne $navy) {
            throw "Expected a nonblank logo with navy padding: $outputPath"
        }
        Write-Output "$FileName : $($check.Width)x$($check.Height), $foregroundPixels foreground pixels, opaque navy background"
    }
    finally { $check.Dispose() }
}

Export-Logo 'icon.png' 80
Export-Logo 'largeIcon.png' 130
if ($IncludeLogo400) { Export-Logo 'logo-400.png' 400 }
