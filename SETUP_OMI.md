# 🎧 Omi Integration Setup Guide

Quick setup guide for the Omi Bluetooth integration in RAGrecordingMVP.

## 🚀 Quick Start

### 1. Repository Setup
```bash
# Clone the MVP repository
git clone https://github.com/amywork777/RAGrecordingMVP.git
cd RAGrecordingMVP/mobile
```

### 2. Install Dependencies  
```bash
npm install
```

### 3. Build Development Client
```bash
# iOS
npx expo run:ios

# Android  
npx expo run:android
```

### 4. Connect Omi Device
1. Open the app on your physical device
2. Navigate to the "Omi Device" section
3. Tap the headset icon to expand
4. Tap "Scan" to discover Omi devices
5. Select your device and tap "Connect"
6. Start streaming and enjoy real-time transcription!

## ✨ New Features Added

### Services
- **OmiBluetoothService** - Manages Omi device connections
- **OmiAudioStreamService** - Handles audio streaming and STT processing

### UI Components  
- **OmiDevicePairing** - Device discovery and connection interface
- **OmiStreamingStatus** - Real-time streaming controls

### Integration
- **Enhanced RecordScreen** - Omi section added seamlessly
- **Multi-codec Support** - PCM16, PCM8, and Opus audio formats
- **Real-time Transcription** - Live speech-to-text with chunked processing

## 🔧 Technical Architecture

```
Omi Device → Bluetooth → Audio Stream → Buffer (3s chunks) → STT → RAG-in-a-box → UI
```

### Audio Processing Flow:
1. Omi device streams audio via Bluetooth Low Energy
2. Audio is buffered in 3-second chunks for optimal processing
3. Multiple codecs (PCM16, PCM8, Opus) are automatically converted to WAV
4. Processed through existing STT pipeline (Whisper/AssemblyAI)
5. Transcriptions sent to RAG-in-a-box for intelligent responses
6. Results displayed in familiar chat interface

## 🛠️ Configuration Options

### Audio Settings (in OmiAudioStreamService.ts):
```typescript
bufferDurationSeconds: 3        // Chunk size before STT processing
enableRealTimeTranscription: true  // Live transcription toggle
sampleRate: 16000              // 16kHz optimal for Omi devices  
channels: 1                    // Mono audio
```

### Connection Settings (in OmiBluetoothService.ts):
```typescript
scanTimeout: 10000             // 10 second device discovery
```

## 📱 User Experience

### Device Connection
- **One-tap scanning** for Omi device discovery
- **Visual signal strength** indicators
- **Auto-connection** to previously paired devices
- **Battery level monitoring** for connected devices

### Audio Streaming
- **Start/Stop controls** with live status indicators
- **Real-time transcription** display during streaming  
- **Audio quality metrics** (data rate, codec, duration)
- **Buffer progress** visualization

### Integration with Existing Features
- **Webhook monitoring** continues during Omi streaming
- **Built-in recording** remains independent
- **Chat interface** works with all audio sources

## 🧪 Testing Checklist

- [ ] Omi device discovery works
- [ ] Bluetooth connection establishes successfully  
- [ ] Audio streaming starts/stops correctly
- [ ] Real-time transcription appears
- [ ] Final transcripts save to history
- [ ] Connection survives app backgrounding
- [ ] Both audio sources work independently
- [ ] UI remains responsive during streaming

## 🐛 Common Issues

### Device Not Found
- Ensure Omi device is powered on
- Check Bluetooth is enabled on phone
- Try restarting the scan

### Connection Drops  
- Verify devices are within range
- Check Omi battery level
- Ensure no other apps are connected to Omi

### No Transcription
- Confirm microphone permissions granted
- Check network connectivity  
- Verify backend STT service is running

## 🎯 Key Implementation Answers

### Your Original Questions:

**1. Bluetooth connection logic structure:**
- Implemented as separate service layer (`OmiBluetoothService`) using official Omi SDK
- Event-driven architecture matching existing BLE patterns
- Robust connection management with auto-cleanup

**2. Audio buffering between Omi streaming and STT:**  
- 3-second audio chunks balance latency vs. processing efficiency
- Multi-codec support with automatic WAV conversion
- Memory-efficient buffer management with automatic cleanup

**3. Robust reconnection logic:**
- Automatic connection state monitoring
- Graceful disconnect handling with user notifications
- Event-based reconnection attempts on connection loss

**4. Error handling patterns:**
- Comprehensive try-catch blocks for all Bluetooth operations
- User-friendly error messages with actionable guidance  
- Fallback behavior for network and device issues

**5. Omi audio stream integration with RAG-in-a-box:**
- Seamless integration through existing `APIService.sendAudioBase64` 
- Real-time transcription chunks processed immediately
- Final transcripts enhanced with AI-generated titles and summaries

## 🎉 Ready to Go!

Your RAGrecordingMVP now has full Omi integration while preserving essential functionality. The app supports two audio input methods working independently:

1. **Built-in Recording** (preserved)
2. **Omi Devices** (new!)

Enjoy seamless voice recording and intelligent transcription! 🚀