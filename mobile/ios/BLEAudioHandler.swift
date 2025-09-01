import Foundation
import AVFoundation

class BLEAudioHandler {
    private let audioManager = AudioPlaybackManager()
    
    /// Handle received audio data from BLE device
    /// Automatically detects ADPCM vs WAV and plays accordingly
    func handleReceivedAudioData(_ data: Data) {
        print("Received audio data: \(data.count) bytes")
        
        // Quick format detection for logging
        if ADPCMDecoder.isADPCMFormat(data) {
            print("📦 ADPCM format detected - will decode to PCM")
        } else {
            print("🎵 WAV format detected - playing directly")
        }
        
        // Play the audio (automatic format handling)
        audioManager.playAudioFile(data: data) { success, error in
            if success {
                print("✅ Audio playback completed")
                // Optional: Notify UI that playback finished
                NotificationCenter.default.post(name: .audioPlaybackCompleted, object: nil)
            } else {
                print("❌ Audio playback failed: \(error ?? "Unknown error")")
                // Optional: Show error to user
                NotificationCenter.default.post(name: .audioPlaybackFailed, 
                                              object: error)
            }
        }
    }
    
    /// Alternative: Get AVAudioPlayer for more control
    func createPlayerForReceivedAudio(_ data: Data) -> AVAudioPlayer? {
        do {
            let player = try audioManager.createAudioPlayer(from: data)
            print("✅ Audio player created successfully")
            print("Duration: \(player.duration) seconds")
            return player
        } catch {
            print("❌ Failed to create audio player: \(error.localizedDescription)")
            return nil
        }
    }
}

// MARK: - Notification Names
extension NSNotification.Name {
    static let audioPlaybackCompleted = NSNotification.Name("audioPlaybackCompleted")
    static let audioPlaybackFailed = NSNotification.Name("audioPlaybackFailed")
}

// MARK: - Usage Example
/*
 How to integrate with your existing BLE code:
 
 class YourBLEManager {
     private let audioHandler = BLEAudioHandler()
     
     func didReceiveAudioFile(_ data: Data) {
         // Old code:
         // let player = try? AVAudioPlayer(data: data)
         // player?.play()
         
         // New code (handles both ADPCM and WAV):
         audioHandler.handleReceivedAudioData(data)
     }
 }
 */