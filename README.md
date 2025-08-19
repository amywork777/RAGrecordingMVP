# AI Wearable Companion App

A full-stack application for AI-powered wearable devices that records, transcribes, and enables intelligent search through conversations using RAG (Retrieval-Augmented Generation) technology.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App (Expo/React Native)          │
│  ┌─────────────┐                         ┌────────────┐    │
│  │ Record Screen│                         │ Chat Screen│    │
│  └──────┬──────┘                         └─────┬──────┘    │
│         │                                      │            │
│    ┌────▼────────────────────────────────────▼─────┐       │
│    │            BLE Service (Simulated)            │       │
│    └────────────────────┬───────────────────────────┘       │
└─────────────────────────┼───────────────────────────────────┘
                          │ Audio Chunks
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

## Features

### Mobile App
- **BLE Connection**: Simulated Bluetooth Low Energy connection to wearable device
- **Audio Streaming**: Real-time audio chunk streaming from device
- **Live Transcription**: Display transcriptions as they're processed
- **Memory Search**: Natural language search through past conversations
- **Chat Interface**: Q&A interface for querying stored memories

### Backend
- **Audio Transcription**: OpenAI Whisper integration for speech-to-text
- **Vector Storage**: ZeroEntropy integration for embeddings and storage
- **RAG Pipeline**: Full retrieval-augmented generation for intelligent answers
- **RESTful API**: Clean endpoints for transcription and search

## Tech Stack

### Frontend
- React Native with Expo
- TypeScript
- React Navigation
- BLE PLX (for future real BLE implementation)

### Backend
- Node.js with Express
- TypeScript
- OpenAI API (Whisper)
- ZeroEntropy SDK
- Multer for file handling

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- Expo CLI (`npm install -g expo-cli`)
- OpenAI API key
- ZeroEntropy API key and Project ID

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables in `.env`:
```env
PORT=3000
OPENAI_API_KEY=your_openai_api_key_here
ZEROENTROPY_API_KEY=your_zeroentropy_api_key_here
ZEROENTROPY_PROJECT_ID=your_project_id_here
```

4. Start the development server:
```bash
npm run dev
```

### Mobile App Setup

1. Navigate to mobile directory:
```bash
cd mobile
```

2. Install dependencies:
```bash
npm install
```

3. Configure API endpoint (optional):
Create a `.env` file if you need to change the backend URL:
```env
EXPO_PUBLIC_API_URL=http://your-backend-url:3000
```

4. Start Expo development server:
```bash
npx expo start
```

5. Run on your device:
- Press `i` for iOS simulator
- Press `a` for Android emulator
- Scan QR code with Expo Go app for physical device

## API Endpoints

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

## Troubleshooting

### Common Issues

1. **Connection refused on mobile app**:
   - Ensure backend is running
   - Check IP address if testing on physical device
   - Update `EXPO_PUBLIC_API_URL` in mobile `.env`

2. **Transcription returns simulated data**:
   - Verify OpenAI API key is set correctly
   - Check API key has Whisper access

3. **Search returns empty results**:
   - Verify ZeroEntropy credentials
   - Check if documents are being stored properly

## License

MIT

## Contributors

Built with Claude Code 🤖