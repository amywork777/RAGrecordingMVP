# AI Wearable Companion App

A full-stack application for AI-powered wearable devices that records, transcribes, and enables intelligent search through conversations using RAG (Retrieval-Augmented Generation) technology.

## 🚧 Current Implementation Status

### Phase 1: Completed ✅
- **Mobile App**: Expo React Native with transcription, RAG search, and individual chat
- **Backend**: Node.js with OpenAI Whisper, ZeroEntropy, and Supabase integration 
- **Simulation**: BLE service simulation for development/testing

### Phase 2: Hardware Integration 🔄
- **Hardware Device**: Seeed XIAO BLE Sense with SD card for audio recording
- **BLE Connection**: Real Bluetooth connectivity to mobile app
- **Auto-sync**: Device automatically sends WAV files to app after recording
- **Physical Controls**: Single button + RGB LED + power switch

## 🎯 Hardware Deliverables

### Materials Required
- **Seeed XIAO BLE Sense board** (with built-in microphone & RGB LED)
- **MicroSD card module** + FAT32 formatted card
- **Battery pack** with ON/OFF power switch  
- **Single tactile button** for recording controls
- **Breadboard and jumper wires** for connections

### Hardware Features
- **Single Button Controls**:
  - Single-click: Start/stop recording (toggle)
  - Double-click: Force sync all unsent files (manual fallback)
- **Auto-sync**: After recording stops → fast advertise (60s) → auto-sync when app connects
- **LED Status Indicators**:
  - 🔴 Recording: Red solid
  - 🔵 Connected: Blue solid  
  - 🟢 Syncing: Green solid
  - 🔵 Fast advertising: Blue blink
  - 🔴 Low battery/Error: Red blink
  - ⚫ Idle: Off
- **Power Management**: Battery + switch for ON/OFF control

### BLE Workflow
1. **Idle**: Device slow-advertises (low power, discoverable)
2. **Recording**: No transfers, just record to SD card
3. **Stop Recording**: Finalize WAV → fast advertise for 60s
4. **Auto-Connect**: App connects → automatic sync of all unsent WAVs
5. **File Management**: App can list/delete files on device SD card

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│              XIAO BLE Hardware Device                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Button    │    │ Microphone  │    │  RGB LED    │    │
│  │   Control   │    │ Recording   │    │  Status     │    │
│  └─────┬───────┘    └──────┬──────┘    └──────┬──────┘    │
│        │                   │                  │            │
│        └───────────────────▼──────────────────┘            │
│                      Main Controller                       │
│                           │                                │
│    ┌──────────────────────┼──────────────────────┐        │
│    │           SD Card Storage (WAV Files)       │        │
│    └──────────────────────┼──────────────────────┘        │
│                           │                                │
│    ┌──────────────────────▼──────────────────────┐        │
│    │         BLE File Transfer Protocol          │        │
│    └──────────────────────┬──────────────────────┘        │
└───────────────────────────┼───────────────────────────────┘
                           │ WAV Files via BLE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App (Expo/React Native)          │
│  ┌─────────────┐                         ┌────────────┐    │
│  │Record Screen│                         │ Chat Screen│    │
│  │Device Conn. │                         │RAG Search  │    │
│  └──────┬──────┘                         └─────┬──────┘    │
│         │                                      │            │
│    ┌────▼────────────────────────────────────▼─────┐       │
│    │          Real BLE Service (react-native-ble-plx) │    │
│    │          • Device Discovery                      │    │
│    │          • File Transfer                         │    │
│    │          • Auto-sync                             │    │
│    └────────────────────┬───────────────────────────┘       │
└─────────────────────────┼───────────────────────────────────┘
                          │ WAV Files for Transcription
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Node.js/Express)                 │
│  ┌──────────────────────────────────────────────────┐      │
│  │            Transcription Service (Whisper)       │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────┐      │
│  │         ZeroEntropy RAG Pipeline                 │      │
│  │  • Embedding Generation                          │      │
│  │  • Vector Storage                                │      │
│  │  • Semantic Search                               │      │
│  │  • Answer Generation                             │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start Guide

### 📋 Prerequisites
- **Node.js 18+** and npm
- **OpenAI API Key** for Whisper transcription
- **ZeroEntropy API Key** for RAG functionality  
- **Physical iPhone/Android device** (BLE requires real device, not simulator)
- **Developer mode enabled** on iPhone for Expo testing

### 🔧 Backend Setup
```bash
cd backend
npm install

# Configure API keys in .env
echo "OPENAI_API_KEY=sk-..." > .env
echo "ZEROENTROPY_API_KEY=ze_..." >> .env
echo "PORT=3000" >> .env

npm start
```

### 📱 Mobile App Setup  
```bash
cd mobile
npm install

# Start Expo development server
npx expo start
```

⚠️ **Important**: For BLE hardware integration, you'll need a **custom Expo Dev Build** (Expo Go cannot connect to hardware directly).

### 📋 Step-by-Step Instructions:

1. **Open two terminal windows**

2. **Terminal 1 (Backend)**:
```bash
cd /path/to/your/RAGrecording/backend
npm start
```

3. **Terminal 2 (Mobile App)**:
```bash
cd /path/to/your/RAGrecording/mobile  
npx expo start
```

4. **Connect your phone**:
   - Install Expo Go app from App Store/Google Play
   - Scan the QR code that appears in Terminal 2
   - Or open http://localhost:8081 in browser to see QR code

### 🎯 What You'll See:
- **Backend**: Runs on http://localhost:3000
- **Mobile App**: QR code for Expo Go connection
- **Features**: Recording, transcription, individual transcript chat, RAG search

## Current Features

### Mobile App ✅
- **Device Connection**: "Device Connected" status indicator
- **BLE Integration**: Real Bluetooth connectivity to XIAO hardware
- **WAV File Transfer**: Automatic sync from device after recording
- **Transcription Display**: AI-generated titles and summaries  
- **Memory Search**: Natural language search through conversations
- **Individual Chat**: Q&A interface for each transcript
- **File Management**: List/delete files on device SD card

### Hardware Device ✅  
- **Audio Recording**: 16kHz mono WAV files to SD card
- **BLE File Transfer**: Credit-based protocol for reliable transfers
- **Button Controls**: Single tactile button with timing-based actions
- **LED Status**: RGB LED shows recording/sync/connection states
- **Power Management**: Battery + switch for portable operation
- **Auto-sync**: Automatic file transfer after recording completion

### Backend ✅
- **Audio Transcription**: OpenAI Whisper integration 
- **Vector Storage**: ZeroEntropy RAG pipeline
- **Smart Processing**: Diarization for multi-speaker detection
- **RESTful API**: Clean endpoints for all operations

## Tech Stack

### Hardware
- **Seeed XIAO BLE Sense** (nRF52840 + built-in microphone + RGB LED)
- **MicroSD Card Storage** for WAV file buffering
- **Arduino/PlatformIO** firmware with C++ 
- **BLE Protocol** for wireless file transfer

### Mobile App  
- **React Native** with Expo framework
- **TypeScript** for type safety
- **react-native-ble-plx** for Bluetooth connectivity
- **React Navigation** for screen management
- **Custom Dev Build** required for BLE hardware access

### Backend
- **Node.js** with Express server
- **OpenAI Whisper API** for speech-to-text
- **ZeroEntropy SDK** for RAG vector storage
- **Supabase** (optional) for metadata persistence

## 🔧 Advanced Configuration

### Custom Expo Dev Build (Required for BLE)
Since Expo Go cannot access Bluetooth hardware, you need a custom development build:

```bash
# Install Expo CLI
npm install -g @expo/cli

# Generate development build
cd mobile
npx expo run:ios     # for iOS
npx expo run:android # for Android
```

### LAN Network Setup
If testing on physical device, configure network access:

1. **Find your computer's LAN IP**:
```bash
# macOS/Linux
ipconfig getifaddr en0  # or en1 if en0 fails

# Windows  
ipconfig | findstr IPv4
```

2. **Configure mobile app** (`mobile/.env`):
```env
EXPO_PUBLIC_API_URL=http://192.168.1.100:3000
```

3. **Start with LAN mode**:
```bash
npx expo start --lan
```

### Environment Variables

**Backend** (`backend/.env`):
```env
PORT=3000
OPENAI_API_KEY=sk-proj-...
ZEROENTROPY_API_KEY=ze_...
# Optional Supabase integration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Mobile** (`mobile/.env`):
```env
EXPO_PUBLIC_API_URL=http://192.168.1.100:3000
```

## API Endpoints
### GET /api/zeroentropy/documents
Returns recent documents from ZeroEntropy. When Supabase is configured, each document includes `aiTitle` and `aiSummary` (persisted), and `durationSeconds` when available.

### POST /api/zeroentropy/upload-text
Upload raw text and store as a document in ZeroEntropy. If Supabase is configured, also upserts `documents` and writes the latest AI `title/summary`.

### POST /api/zeroentropy/upload-file
Upload a file (.txt stored directly; .wav/.m4a/.mp4 transcribed first) and then stored in ZeroEntropy. Also upserts Supabase `documents` + AI `title/summary` when configured.

### POST /api/zeroentropy/sync-to-supabase
Backfill existing ZeroEntropy documents to Supabase in one call.
Body: `{ "limit": 500, "includeAnnotations": true }`

## Diarization Strategy
- Non‑diarized first pass (AssemblyAI) to get a clean transcript
- LLM classification (OpenAI) to decide single vs multi speaker (text-only heuristic)
- If multi, diarized pass with backend smoothing:
  - Collapse to single when one speaker dominates talk-time
  - Absorb short flip segments
  - Merge adjacent same‑speaker utterances

> more testing needed to be done for multi-speaker conversation


### POST /api/transcribe
Transcribe audio chunks and store in vector database.

**Request:**
```multipart/form-data
audio: audio file (wav/mp3)
recordingId: string
```

**Response:**
```json
{
  "transcription": "Transcribed text here",
  "documentId": "uuid",
  "recordingId": "recording-id",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### POST /api/search
Search through stored transcripts using natural language.

**Request:**
```json
{
  "query": "What did I say about the project timeline?",
  "limit": 5
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "text": "Relevant transcript segment",
      "timestamp": "2024-01-01T00:00:00Z",
      "recordingId": "recording-id",
      "score": 0.92
    }
  ],
  "answer": "Based on your recordings, you mentioned...",
  "query": "Original query",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### GET /api/transcripts/recent
Get recent transcript entries.

**Query Parameters:**
- `limit`: Number of results (default: 10)

## Example Query Flow

### User Journey: "What did I say about X last week?"

1. **User Input**: Types query in Chat screen
2. **API Call**: Mobile app sends POST to `/api/search`
3. **Embedding Generation**: ZeroEntropy creates query embedding
4. **Vector Search**: Searches vector database for similar content
5. **Results Retrieval**: Top-N relevant segments retrieved
6. **Answer Generation**: RAG pipeline generates contextual answer
7. **Response Display**: Chat UI shows answer + source segments

### Data Flow Example:

```javascript
// 1. Audio chunk received from BLE device
const audioChunk = new ArrayBuffer(32000);

// 2. Send to backend for transcription
const response = await fetch('http://localhost:3000/api/transcribe', {
  method: 'POST',
  body: formData // contains audio chunk
});

// 3. Backend processes with Whisper
const transcription = "Discussed the Q4 roadmap and key milestones";

// 4. Store in ZeroEntropy with metadata
const document = {
  text: transcription,
  metadata: {
    recordingId: "rec-123",
    timestamp: "2024-01-01T10:00:00Z"
  }
};

// 5. User searches: "What about the roadmap?"
const searchResults = await zeroEntropy.search("What about the roadmap?");

// 6. Return relevant segments with scores
{
  results: [{
    text: "Discussed the Q4 roadmap and key milestones",
    score: 0.95
  }],
  answer: "You discussed the Q4 roadmap and mentioned key milestones."
}
```

## Development Notes

### Extending the System

1. **Real BLE Implementation**: Replace simulated BLE service with actual `react-native-ble-plx` implementation
2. **Advanced RAG Features**: Add memory context windows, conversation threading
3. **User Management**: Add authentication and multi-user support
4. **Export Functionality**: Add ability to export transcripts to various formats
5. **Voice Commands**: Add voice-activated recording and commands

### Architecture Decisions

- **Chunked Audio Processing**: Enables real-time transcription without waiting for full recording
- **Vector Storage**: Semantic search superior to keyword matching for conversational data
- **Simulated BLE**: Allows development without hardware dependency
- **TypeScript**: Type safety across full stack reduces runtime errors

## 🛠️ Hardware Assembly Guide

### Circuit Connections
```
XIAO BLE Sense Pinout:
• D0: Not used (single button only)  
• D1: Single tactile button (INPUT_PULLUP)
• D6: SD card CS (Chip Select)
• D8: SD card SCK (Clock)  
• D9: SD card MISO (Data Out)
• D10: SD card MOSI (Data In)
• 3V3: SD card VCC + Button pullup
• GND: SD card + Button + Battery ground
• VIN: Battery positive through power switch
```

### Physical Assembly
1. **Power Circuit**: Battery pack → SPST switch → XIAO VIN pin
2. **SD Card Module**: Connect via SPI pins (D6,D8,D9,D10)  
3. **Single Button**: Connect between D1 and GND
4. **All components share common ground**

### Firmware Upload
```bash
# Using PlatformIO
cd tainecklace_hardware
platformio run --target upload

# Or using Arduino IDE
# Open tainecklace_hardware/src/main.cpp
# Select "Seeed XIAO BLE Sense" board
# Upload via USB
```

## 🐛 Troubleshooting

### BLE Connection Issues
- **Expo Go limitation**: Use custom dev build for BLE access
- **Device not found**: Ensure hardware is advertising (double-click button)  
- **Connection drops**: Check distance and interference
- **iOS permissions**: Enable Bluetooth in Settings → Privacy

### Network Issues
- **Backend unreachable**: Check LAN IP configuration in `mobile/.env`
- **CORS errors**: Ensure backend allows mobile app origin
- **API key errors**: Verify OpenAI/ZeroEntropy keys in `backend/.env`

### Hardware Issues  
- **No recording**: Check SD card formatting (FAT32) and connections
- **LED not working**: Verify RGB LED pin definitions for XIAO
- **Button unresponsive**: Check pullup resistor and debouncing
- **Battery drain**: Implement sleep mode in firmware for power saving

### Expo Development
```bash
# Clear cache and restart
npx expo start --clear

# Check device connectivity  
npx expo doctor

# Install missing dependencies
npx expo install --fix

# Custom dev build (required for BLE)
npx expo run:ios --device
```

## License

MIT

## Contributors

Built with Claude Code 🤖