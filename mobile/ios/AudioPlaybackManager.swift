import Foundation
import AVFoundation

class AudioPlaybackManager: NSObject {
    private var audioPlayer: AVAudioPlayer?
    
    /// Play audio file with automatic ADPCM/WAV detection
    func playAudioFile(data: Data, completion: @escaping (Bool, String?) -> Void) {
        // Use ADPCMDecoder for format detection and playback
        ADPCMDecoder.playAudio(data: data) { [weak self] success, error in
            DispatchQueue.main.async {
                if success {
                    print("Audio playback completed successfully")
                    completion(true, nil)
                } else {
                    let errorMessage = error?.localizedDescription ?? "Unknown playback error"
                    print("Audio playback failed: \(errorMessage)")
                    completion(false, errorMessage)
                }
            }
        }
    }
    
    /// Alternative method for more control over playback
    func createAudioPlayer(from data: Data) throws -> AVAudioPlayer {
        let audioData: Data
        
        // Check format and decode if needed
        if ADPCMDecoder.isADPCMFormat(data) {
            print("Converting ADPCM to WAV...")
            guard let decodedData = ADPCMDecoder.decodeADPCMToWAV(data) else {
                throw NSError(domain: "AudioPlaybackManager", code: 1, 
                            userInfo: [NSLocalizedDescriptionKey: "Failed to decode ADPCM data"])
            }
            audioData = decodedData
        } else {
            print("Using WAV data directly")
            audioData = data
        }
        
        return try AVAudioPlayer(data: audioData)
    }
    
    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
}

// MARK: - Usage Examples
extension AudioPlaybackManager {
    
    /// Example: Simple one-shot playback
    func playReceivedAudio(_ data: Data) {
        playAudioFile(data: data) { success, error in
            if success {
                print("✅ Audio played successfully")
            } else {
                print("❌ Playback failed: \(error ?? "Unknown error")")
            }
        }
    }
    
    /// Example: Advanced playback with player control
    func setupAudioPlayerWithControls(_ data: Data) throws {
        audioPlayer = try createAudioPlayer(from: data)
        audioPlayer?.delegate = self
        audioPlayer?.prepareToPlay()
        
        print("Audio duration: \(audioPlayer?.duration ?? 0) seconds")
        
        // Now you can control playback
        audioPlayer?.play()
        // audioPlayer?.pause()
        // audioPlayer?.stop()
    }
}

// MARK: - AVAudioPlayerDelegate
extension AudioPlaybackManager: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        print("Audio finished playing. Success: \(flag)")
        audioPlayer = nil
    }
    
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        print("Audio decode error: \(error?.localizedDescription ?? "Unknown")")
        audioPlayer = nil
    }
}