# RAGrecordingMVP - Omi Bluetooth Integration

This is an enhanced version of the RAGrecording app that integrates Omi's Bluetooth functionality for seamless audio streaming and transcription. The app now supports three different audio input methods:

1. **Built-in Recording** - Direct microphone recording via the mobile app
2. **XIAO Hardware** - BLE-based file transfer from XIAO recording devices
3. **Omi Devices** - Real-time audio streaming from Omi hardware devices

## 🚀 Features

### Core Features (Preserved from Original)
- Real-time audio transcription using Whisper/AssemblyAI
- RAG-in-a-box integration for intelligent responses
- Chat interface for interacting with transcriptions
- Webhook monitoring for external hardware recordings
- Auto-scanning for BLE devices
- Secure file storage and management

### New Omi Integration Features
- **Omi Device Discovery**: Scan for and connect to Omi Bluetooth devices
- **Real-time Audio Streaming**: Continuous audio streaming from Omi devices
- **Multi-codec Support**: PCM16, PCM8, and Opus audio codec support
- **Live Transcription**: Real-time speech-to-text processing with chunked audio
- **Battery Monitoring**: Display Omi device battery levels
- **Connection Management**: Robust connection handling with auto-reconnection

## 🔧 Architecture

### Services Layer
- **OmiBluetoothService**: Manages Omi device connections using the official Omi React Native SDK
- **OmiAudioStreamService**: Handles audio buffering, processing, and STT integration
- **Existing Services**: Preserved all original BLE, Audio Recording, and API services

### UI Components
- **OmiDevicePairing**: Device discovery and connection interface
- **OmiStreamingStatus**: Real-time streaming controls and status display
- **Enhanced RecordScreen**: Integrated Omi controls alongside existing functionality

## 📱 Installation & Setup

### Prerequisites
1. **Expo Dev Client**: Required for BLE functionality (cannot use Expo Go)
2. **iOS/Android Device**: Physical device needed for Bluetooth testing
3. **Omi Device**: Physical Omi hardware device for testing
4. **Backend Services**: RAG-in-a-box backend must be running

### Dependencies
```bash
cd mobile
npm install
```

Key dependencies automatically installed:
- `@omiai/omi-react-native` - Official Omi SDK
- `react-native-ble-plx` - Bluetooth Low Energy support
- All existing dependencies preserved

### iOS Configuration
The app.json already includes required iOS permissions:
```json
{
  "ios": {
    "infoPlist": {
      "NSMicrophoneUsageDescription": "This app needs access to the microphone to record audio for transcription.",
      "NSBluetoothAlwaysUsageDescription": "This app needs Bluetooth access to connect to Omi recording devices for audio streaming.",
      "NSBluetoothPeripheralUsageDescription": "This app needs Bluetooth access to connect to Omi recording devices for audio streaming.",
      "UIBackgroundModes": ["audio", "bluetooth-central"]
    }
  }
}
```

### Android Configuration
Android permissions are pre-configured:
```json
{
  "android": {
    "permissions": [
      "android.permission.RECORD_AUDIO",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_CONNECT"
    ]
  }
}
```

## 🚀 Running the App

### Development Build
```bash
# Start the development server
npx expo start --dev-client

# Build and install dev client (first time only)
npx expo run:ios
# or
npx expo run:android
```

### Production Build
```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## 🎛️ Usage Guide

### Connecting Omi Devices

1. **Open the App**: Launch the RAGrecordingMVP app
2. **Access Omi Section**: In the main recording screen, find the "Omi Device" section
3. **Scan for Devices**: Tap the headset icon to expand and then tap "Scan"
4. **Connect**: Select your Omi device from the discovered devices list
5. **Start Streaming**: Once connected, tap "Start Streaming" to begin real-time audio capture

### Audio Processing Flow

```
Omi Device → Bluetooth → Audio Stream → Buffer → STT → RAG-in-a-box → UI Response
```

1. **Audio Capture**: Omi device streams audio via Bluetooth
2. **Buffering**: Audio is buffered in 3-second chunks for optimal processing
3. **Format Conversion**: Audio is converted to WAV format for STT compatibility
4. **Transcription**: Processed through existing STT pipeline (Whisper/AssemblyAI)
5. **RAG Integration**: Transcripts are sent to RAG-in-a-box for intelligent processing
6. **Display**: Results shown in the familiar chat interface

### Managing Multiple Input Sources

The app seamlessly handles multiple audio input sources:
- **Omi streaming** and **microphone recording** can be used independently
- **XIAO device** file transfers work alongside Omi streaming
- **Webhook monitoring** continues running for external hardware integration

## 🔧 Configuration

### Audio Streaming Settings

The Omi audio service can be configured in `OmiAudioStreamService.ts`:

```typescript
const streamingOptions = {
  bufferDurationSeconds: 3,        // Buffer duration before STT processing
  enableRealTimeTranscription: true, // Enable live transcription
  sampleRate: 16000,               // Audio sample rate (16kHz typical for Omi)
  channels: 1                      // Mono audio channel
};
```

### Connection Timeout Settings

Bluetooth connection timeouts in `OmiBluetoothService.ts`:

```typescript
await this.omiConnection.scanForDevices(10000); // 10 second scan timeout
```

## 🧪 Testing Guide

### Unit Testing Checklist

1. **Omi Device Discovery**
   - [ ] Scan finds available Omi devices
   - [ ] Device list updates with signal strength
   - [ ] Scan timeout works correctly

2. **Connection Management**
   - [ ] Successful device pairing
   - [ ] Connection status updates correctly
   - [ ] Graceful disconnect handling
   - [ ] Auto-reconnection on connection loss

3. **Audio Streaming**
   - [ ] Real-time audio streaming starts/stops
   - [ ] Audio buffering works correctly
   - [ ] Multiple codec support (PCM16, PCM8, Opus)
   - [ ] STT integration produces transcriptions

4. **UI Integration**
   - [ ] Omi section appears in RecordScreen
   - [ ] Device pairing UI functions correctly
   - [ ] Streaming status displays properly
   - [ ] Live transcription updates in real-time

### Integration Testing

1. **Multi-source Audio**
   - Test Omi streaming while XIAO auto-scan is active
   - Verify webhook monitoring continues during Omi streaming
   - Ensure built-in recording works independently

2. **Network Resilience**
   - Test behavior during backend connectivity issues
   - Verify audio buffering continues during network interruptions
   - Check STT retry logic for failed API calls

## 🛠️ Development Notes

### Code Structure

```
src/
├── services/
│   ├── OmiBluetoothService.ts      # Omi device connection management
│   ├── OmiAudioStreamService.ts    # Audio processing and STT integration
│   └── [existing services...]     # Preserved original services
├── components/
│   ├── OmiDevicePairing.tsx       # Device discovery and pairing UI
│   ├── OmiStreamingStatus.tsx     # Streaming controls and status
│   └── [existing components...]   # Preserved original components
└── screens/
    └── RecordScreen.tsx           # Enhanced with Omi integration
```

### Key Integration Points

1. **Event System**: Omi services use the same event emitter pattern as existing BLE services
2. **STT Pipeline**: Omi audio feeds into the existing APIService.sendAudioBase64 method
3. **UI Consistency**: New components follow the same design system as existing UI
4. **State Management**: Omi state integrated into existing RecordScreen state structure

### Performance Considerations

- **Audio Buffering**: 3-second chunks balance latency vs. processing efficiency
- **Memory Management**: Audio buffers are cleared after processing to prevent memory leaks
- **Background Processing**: Audio streaming continues in background using iOS background modes

## 🐛 Troubleshooting

### Common Issues

1. **Omi Device Not Found**
   - Ensure Omi device is powered on and in pairing mode
   - Check Bluetooth is enabled on mobile device
   - Try restarting the scan

2. **Connection Drops**
   - Check Omi device battery level
   - Ensure devices are within Bluetooth range
   - Verify no other apps are connected to the Omi device

3. **No Audio Streaming**
   - Confirm microphone permissions are granted
   - Check if Omi device supports the expected audio codec
   - Verify backend STT service is responding

4. **Transcription Issues**
   - Check network connectivity
   - Verify API keys for STT services
   - Ensure audio quality is sufficient (check signal strength)

### Debug Logging

Enable detailed logging by checking the console output for:
- `🔍` Bluetooth scanning events
- `✅` Connection success messages
- `🎵` Audio streaming status
- `📝` Transcription events
- `❌` Error messages with details

## 📚 API Reference

### OmiBluetoothService Methods

```typescript
// Device scanning
await OmiBluetoothService.scanForDevices(timeoutMs?: number)

// Connection management
await OmiBluetoothService.connectToDevice(deviceId: string)
await OmiBluetoothService.disconnect()

// Audio streaming
await OmiBluetoothService.startAudioStream()
await OmiBluetoothService.stopAudioStream()

// Status queries
OmiBluetoothService.isDeviceConnected(): boolean
OmiBluetoothService.isStreamActive(): boolean
OmiBluetoothService.getConnectedDevice(): OmiDevice | null
```

### OmiAudioStreamService Events

```typescript
// Streaming lifecycle
OmiAudioStreamService.on('streamingStarted', callback)
OmiAudioStreamService.on('streamingStopped', callback)

// Real-time transcription
OmiAudioStreamService.on('realtimeTranscription', callback)
OmiAudioStreamService.on('finalTranscription', callback)

// Audio data events
OmiAudioStreamService.on('liveAudioData', callback)
OmiAudioStreamService.on('audioProcessed', callback)
```

## 🔮 Next Steps

### Potential Enhancements

1. **Multi-device Support**: Connect to multiple Omi devices simultaneously
2. **Audio Quality Settings**: User-configurable sample rates and codecs
3. **Offline Transcription**: Local STT processing when network unavailable
4. **Custom Wake Words**: Omi device trigger word customization
5. **Audio Recording**: Save raw Omi audio streams for later processing

### Integration Improvements

1. **Cloud Sync**: Automatic backup of Omi transcriptions
2. **Analytics Dashboard**: Usage statistics and audio quality metrics
3. **Voice Profiles**: Speaker identification and personalization
4. **Smart Notifications**: Context-aware alerts based on transcription content

## 🤝 Contributing

When contributing to the Omi integration:

1. Follow the existing code style and patterns
2. Add comprehensive error handling for Bluetooth operations
3. Include unit tests for new service methods
4. Update this README with any new features or configuration options
5. Test on both iOS and Android devices with real Omi hardware

## 📄 License

This project maintains the same license as the original RAGrecording application.

---

**Built with ❤️ using Expo, React Native, and the Omi SDK**