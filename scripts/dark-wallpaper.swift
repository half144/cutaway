// Writes the dark-appearance image of light/dark macOS wallpapers (such as Sonoma.heic) as JPEGs, and
// prints each file written. sips only reads a HEIC's primary image, the light one.
// Arguments: pairs of wallpaper and output path; wallpapers without a dark image are skipped.
import Foundation
import ImageIO
import UniformTypeIdentifiers

func darkImage(_ path: String) -> CGImage? {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
        let tag = CGImageMetadataCopyTagWithPath(metadata, nil, "apple_desktop:apr" as CFString),
        let encoded = CGImageMetadataTagCopyValue(tag) as? String,
        let data = Data(base64Encoded: encoded),
        let appearance = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Int],
        let dark = appearance["d"]
  else { return nil }
  return CGImageSourceCreateImageAtIndex(source, dark, nil)
}

let arguments = Array(CommandLine.arguments.dropFirst())
for index in stride(from: 0, to: arguments.count - 1, by: 2) {
  guard let image = darkImage(arguments[index]),
        let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: arguments[index + 1]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
  else { continue }
  CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
  if CGImageDestinationFinalize(destination) { print(arguments[index + 1]) }
}
