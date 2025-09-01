import Foundation
import AVFoundation

class ADPCMDecoder {
    
    // ADPCM step size table for IMA ADPCM
    private static let stepSizeTable: [Int16] = [
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
        19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
        50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
        130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
        337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
        876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
        2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
        5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
        15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
    ]
    
    // Index adjustment table
    private static let indexTable: [Int8] = [
        -1, -1, -1, -1, 2, 4, 6, 8,
        -1, -1, -1, -1, 2, 4, 6, 8
    ]
    
    /// Check if data starts with ADPCM magic bytes "ADPC"
    static func isADPCMFormat(_ data: Data) -> Bool {
        guard data.count >= 4 else { return false }
        let magic = data.prefix(4)
        return magic == Data([0x41, 0x44, 0x50, 0x43]) // "ADPC"
    }
    
    /// Decode ADPCM data to PCM and create a playable WAV file
    static func decodeADPCMToWAV(_ data: Data) -> Data? {
        guard isADPCMFormat(data), data.count > 32 else {
            print("Invalid ADPCM format or insufficient data")
            return nil
        }
        
        // Skip 32-byte header to get compressed data
        let compressedData = data.dropFirst(32)
        
        // Decode ADPCM to PCM
        guard let pcmData = decodeIMA_ADPCM(compressedData) else {
            print("Failed to decode ADPCM data")
            return nil
        }
        
        // Create WAV file with PCM data
        return createWAVFile(pcmData: pcmData, sampleRate: 16000, channels: 1)
    }
    
    /// Decode IMA ADPCM data to 16-bit PCM
    private static func decodeIMA_ADPCM(_ data: Data) -> Data? {
        var pcmData = Data()
        
        // IMA ADPCM state
        var predictor: Int16 = 0
        var stepIndex: Int8 = 0
        
        // Process each byte (2 samples per byte)
        for byte in data {
            // Lower nibble (first sample)
            let sample1 = decodeADPCMSample(
                nibble: Int8(byte & 0x0F),
                predictor: &predictor,
                stepIndex: &stepIndex
            )
            
            // Upper nibble (second sample)
            let sample2 = decodeADPCMSample(
                nibble: Int8((byte >> 4) & 0x0F),
                predictor: &predictor,
                stepIndex: &stepIndex
            )
            
            // Add samples as little-endian 16-bit PCM
            withUnsafeBytes(of: sample1.littleEndian) { pcmData.append(contentsOf: $0) }
            withUnsafeBytes(of: sample2.littleEndian) { pcmData.append(contentsOf: $0) }
        }
        
        return pcmData
    }
    
    /// Decode a single ADPCM nibble to PCM sample
    private static func decodeADPCMSample(nibble: Int8, predictor: inout Int16, stepIndex: inout Int8) -> Int16 {
        let step = stepSizeTable[Int(stepIndex)]
        
        // Calculate difference
        var diff = Int32(step >> 3)
        if nibble & 4 != 0 { diff += Int32(step) }
        if nibble & 2 != 0 { diff += Int32(step >> 1) }
        if nibble & 1 != 0 { diff += Int32(step >> 2) }
        
        // Apply sign
        if nibble & 8 != 0 {
            diff = -diff
        }
        
        // Update predictor
        predictor = Int16(max(-32768, min(32767, Int32(predictor) + diff)))
        
        // Update step index
        stepIndex += indexTable[Int(nibble)]
        stepIndex = max(0, min(88, stepIndex))
        
        return predictor
    }
    
    /// Create WAV file header + PCM data
    private static func createWAVFile(pcmData: Data, sampleRate: UInt32, channels: UInt16) -> Data {
        var wavData = Data()
        
        let dataSize = UInt32(pcmData.count)
        let fileSize = dataSize + 36
        let byteRate = sampleRate * UInt32(channels) * 2 // 16-bit samples
        let blockAlign = channels * 2
        
        // WAV Header
        wavData.append("RIFF".data(using: .ascii)!)                    // ChunkID
        wavData.append(withUnsafeBytes(of: fileSize.littleEndian) { Data($0) })    // ChunkSize
        wavData.append("WAVE".data(using: .ascii)!)                    // Format
        
        // fmt chunk
        wavData.append("fmt ".data(using: .ascii)!)                    // Subchunk1ID
        wavData.append(withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) })  // Subchunk1Size
        wavData.append(withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) })   // AudioFormat (PCM)
        wavData.append(withUnsafeBytes(of: channels.littleEndian) { Data($0) })    // NumChannels
        wavData.append(withUnsafeBytes(of: sampleRate.littleEndian) { Data($0) })  // SampleRate
        wavData.append(withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })    // ByteRate
        wavData.append(withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })  // BlockAlign
        wavData.append(withUnsafeBytes(of: UInt16(16).littleEndian) { Data($0) })  // BitsPerSample
        
        // data chunk
        wavData.append("data".data(using: .ascii)!)                    // Subchunk2ID
        wavData.append(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })    // Subchunk2Size
        wavData.append(pcmData)                                        // PCM Data
        
        return wavData
    }
}

// MARK: - Audio Playback Extension
extension ADPCMDecoder {
    
    /// Play audio data (ADPCM or WAV) with automatic format detection
    static func playAudio(data: Data, completion: @escaping (Bool, Error?) -> Void) {
        let audioData: Data
        
        // Check format and decode if needed
        if isADPCMFormat(data) {
            print("Detected ADPCM format, decoding...")
            guard let decodedData = decodeADPCMToWAV(data) else {
                completion(false, NSError(domain: "ADPCMDecoder", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to decode ADPCM"]))
                return
            }
            audioData = decodedData
        } else {
            print("Using WAV format directly")
            audioData = data
        }
        
        // Play with AVAudioPlayer
        do {
            let player = try AVAudioPlayer(data: audioData)
            player.prepareToPlay()
            player.play()
            
            // Simple completion after estimated duration
            DispatchQueue.main.asyncAfter(deadline: .now() + player.duration) {
                completion(true, nil)
            }
        } catch {
            completion(false, error)
        }
    }
}