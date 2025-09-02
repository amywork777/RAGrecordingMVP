import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import transcriptionRoutes from './routes/transcription';
import searchRoutes from './routes/search';
import zeroEntropyRoutes from './routes/zeroentropy';
import chatRoutes from './routes/chat';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve audio files statically
app.use('/audio', express.static(path.join(__dirname, '../audio_files'), {
  setHeaders: (res, filePath) => {
    // Set appropriate headers for audio files
    if (filePath.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4');
    } else if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.1', // Force deployment refresh
    services: {
      transcription: 'operational',
      zeroentropy: 'operational', 
      search: 'operational',
    },
  });
});

app.use('/api', transcriptionRoutes);
app.use('/api', searchRoutes);
app.use('/api/zeroentropy', zeroEntropyRoutes);
app.use('/api/chat', chatRoutes);
// Alias for summary endpoint under /api
// Note: The summary route is defined in searchRoutes as POST /summary

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Wearable Companion Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Network access: http://192.168.1.16:${PORT}/health`);
  console.log('\nAvailable endpoints:');
  console.log('POST /api/transcribe - Transcribe audio chunks');
  console.log('POST /api/search - Search through transcripts');
  console.log('POST /api/chat/transcription - Chat with a specific transcription');
  console.log('GET /api/transcripts/recent - Get recent transcripts');
  console.log('GET /audio/* - Access stored audio files');
  console.log('\nMake sure to set your environment variables in .env:');
  console.log('- OPENAI_API_KEY');
  console.log('- ZEROENTROPY_API_KEY');
  console.log('- ZEROENTROPY_PROJECT_ID');
  console.log('\nAudio files will be stored in: ./audio_files/YYYY-MM/');
});