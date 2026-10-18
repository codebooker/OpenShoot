import Foundation
import ImageIO
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var out: [String: Any] = [:]
if let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
   let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) as? [String: Any] {
    let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
    let tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
    for key in ["FNumber", "ExposureTime", "FocalLength", "LensModel", "DateTimeOriginal"] { if let value = exif[key] { out[key] = value } }
    if let iso = exif["ISOSpeedRatings"] as? [NSNumber], let first = iso.first { out["ISO"] = first }
    if out["ISO"] == nil { out["ISO"] = exif["ISOSpeed"] ?? exif["RecommendedExposureIndex"] ?? exif["PhotographicSensitivity"] }
    for key in ["Make", "Model"] { if let value = tiff[key] { out[key] = value } }
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
