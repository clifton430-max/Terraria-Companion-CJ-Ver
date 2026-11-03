// Speech-to-text helper for Terraria Companion CJ Ver's push-to-talk.
// Reads one 16-bit PCM mono WAV from stdin, transcribes it with Apple's Speech framework (on-device
// when the Mac supports it), and prints one JSON object to stdout:
//   {"text": "...", "onDevice": true}   or   {"error": "denied|restricted|unavailable|nospeech|badaudio|timeout", "message": "..."}
// Audio stays in memory; nothing is written to disk.

import AVFoundation
import Foundation
import Speech

func emit(_ obj: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func fail(_ kind: String, _ message: String) -> Never {
    emit(["error": kind, "message": message])
}

// --- Read and parse the WAV -------------------------------------------------------------
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count > 44, input.count < 64 * 1024 * 1024 else { fail("badaudio", "The recording was empty or too large.") }
let bytes = [UInt8](input)
func u32(_ i: Int) -> UInt32 { UInt32(bytes[i]) | UInt32(bytes[i + 1]) << 8 | UInt32(bytes[i + 2]) << 16 | UInt32(bytes[i + 3]) << 24 }
func u16(_ i: Int) -> UInt16 { UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8 }
guard String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF", String(bytes: bytes[8..<12], encoding: .ascii) == "WAVE" else {
    fail("badaudio", "The recording isn't a WAV file.")
}
var pos = 12
var sampleRate: Double = 0
var channels = 0
var bits = 0
var dataRange: Range<Int>? = nil
while pos + 8 <= bytes.count {
    let id = String(bytes: bytes[pos..<pos + 4], encoding: .ascii) ?? ""
    let len = Int(u32(pos + 4))
    let body = pos + 8
    if id == "fmt " && body + 16 <= bytes.count {
        channels = Int(u16(body + 2))
        sampleRate = Double(u32(body + 4))
        bits = Int(u16(body + 14))
    } else if id == "data" {
        dataRange = body..<min(bytes.count, body + len)
        break
    }
    pos = body + len + (len & 1)
}
guard let range = dataRange, bits == 16, channels == 1, sampleRate >= 8000 else {
    fail("badaudio", "Unsupported recording format.")
}
let frames = range.count / 2
guard frames > Int(sampleRate * 0.2) else { fail("nospeech", "That was too short to understand.") }
guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else {
    fail("badaudio", "Couldn't prepare the audio.")
}
buffer.frameLength = AVAudioFrameCount(frames)
let out = buffer.floatChannelData![0]
for i in 0..<frames {
    let lo = UInt16(bytes[range.lowerBound + i * 2])
    let hi = UInt16(bytes[range.lowerBound + i * 2 + 1])
    out[i] = Float(Int16(bitPattern: lo | hi << 8)) / 32768.0
}

// --- Permission ---------------------------------------------------------------------------
let authSem = DispatchSemaphore(value: 0)
var auth = SFSpeechRecognizer.authorizationStatus()
if auth == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { status in
        auth = status
        authSem.signal()
    }
    _ = authSem.wait(timeout: .now() + 120)
}
switch auth {
case .authorized: break
case .denied: fail("denied", "Speech Recognition is turned off for Terraria Companion CJ Ver. Turn it on in System Settings → Privacy & Security → Speech Recognition.")
case .restricted: fail("restricted", "Speech Recognition is restricted on this Mac.")
default: fail("denied", "Speech Recognition permission wasn't granted.")
}

// --- Recognise ------------------------------------------------------------------------------
let localeId = CommandLine.arguments.dropFirst().first ?? Locale.current.identifier
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
    fail("unavailable", "Speech recognition isn't available right now.")
}
recognizer.queue = OperationQueue()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = false
let onDevice = recognizer.supportsOnDeviceRecognition
if onDevice { request.requiresOnDeviceRecognition = true }
request.append(buffer)
request.endAudio()

let done = DispatchSemaphore(value: 0)
var text: String? = nil
var errorMessage: String? = nil
let task = recognizer.recognitionTask(with: request) { result, error in
    if let result = result, result.isFinal {
        text = result.bestTranscription.formattedString
        done.signal()
    } else if let error = error {
        errorMessage = error.localizedDescription
        done.signal()
    }
}
if done.wait(timeout: .now() + 30) == .timedOut {
    task.cancel()
    fail("timeout", "Transcription took too long.")
}
if let t = text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
    emit(["text": t, "onDevice": onDevice])
}
fail("nospeech", errorMessage.map { "No speech recognised (\($0))." } ?? "No speech recognised.")
