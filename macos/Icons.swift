import AppKit

// Two bridge piers, a deck and a single arch; a dot marks an active request.
func bridgePath(busy: Bool) -> NSBezierPath {
    let path = NSBezierPath()
    path.lineWidth = 1.6
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.move(to: NSPoint(x: 1.5, y: 7.5))
    path.line(to: NSPoint(x: 16.5, y: 7.5))
    for x in [CGFloat(4), CGFloat(14)] {
        path.move(to: NSPoint(x: x, y: 3.5))
        path.line(to: NSPoint(x: x, y: busy && x == 14 ? 10.5 : 13.5))
    }
    path.move(to: NSPoint(x: 4, y: 8))
    path.curve(to: NSPoint(x: 14, y: 8), controlPoint1: NSPoint(x: 6, y: 15), controlPoint2: NSPoint(x: 12, y: 15))
    return path
}
func bridgeIcon(busy: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
        NSColor.black.setStroke()
        bridgePath(busy: busy).stroke()
        if busy {
            NSColor.black.setFill()
            NSBezierPath(ovalIn: NSRect(x: 12.5, y: 12.5, width: 5, height: 5)).fill()
        }
        return true
    }
    image.isTemplate = true
    return image
}
// Dock icon: the same glyph on a rounded square, following the macOS icon grid (824 pt body in a 1024 pt canvas).
func appIcon() -> NSImage {
    NSImage(size: NSSize(width: 1024, height: 1024), flipped: false) { _ in
        let body = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
        NSGradient(starting: NSColor(calibratedRed: 0.20, green: 0.45, blue: 0.95, alpha: 1), ending: NSColor(calibratedRed: 0.08, green: 0.20, blue: 0.55, alpha: 1))?.draw(in: body, angle: -90)
        let scale: CGFloat = 36
        let glyph = bridgePath(busy: false)
        var placement = AffineTransform(scale: scale)
        placement.append(AffineTransform(translationByX: 512 - 9 * scale, byY: 512 - 9 * scale + 10))
        glyph.transform(using: placement)
        glyph.lineWidth = 1.6 * scale
        NSColor.white.setStroke()
        glyph.stroke()
        return true
    }
}

// Writes icon_16x16.png … icon_512x512@2x.png, the layout `iconutil -c icns` expects.
func renderAppIconSet(to directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let icon = appIcon()
    for (points, scale) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
        let pixels = points * scale
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "OpenBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not render the icon"]) }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        icon.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "OpenBridge", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not encode the icon"]) }
        try data.write(to: directory.appendingPathComponent(scale == 1 ? "icon_\(points)x\(points).png" : "icon_\(points)x\(points)@2x.png"))
    }
}
