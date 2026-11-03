// Reads a PNG from stdin and prints the text in it, line by line, with where each line is, as
// JSON: [{"text": "...", "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1, "confidence": 0..1}], with
// the origin at the top left. Uses Apple's Vision framework on this Mac; nothing leaves it.
import Foundation
import Vision
import AppKit

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let image = NSImage(data: data), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("not an image\n".data(using: .utf8)!)
  exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
  exit(1)
}
var out: [[String: Any]] = []
for obs in request.results ?? [] {
  guard let best = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox // normalized, origin bottom-left
  out.append(["text": best.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "confidence": best.confidence])
}
let json = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(json)
