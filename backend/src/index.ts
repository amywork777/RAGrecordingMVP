import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import transcriptionRoutes from './routes/transcription';
import searchRoutes from './routes/search';
import zeroEntropyRoutes from './routes/zeroentropy';
import chatRoutes from './routes/chat';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
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

app.listen(PORT, () => {
  console.log(`AI Wearable Companion Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('\nAvailable endpoints:');
  console.log('POST /api/transcribe - Transcribe audio chunks');
  console.log('POST /api/search - Search through transcripts');
  console.log('POST /api/chat/transcription - Chat with a specific transcription');
  console.log('GET /api/transcripts/recent - Get recent transcripts');
  console.log('\nMake sure to set your environment variables in .env:');
  console.log('- OPENAI_API_KEY');
  console.log('- ZEROENTROPY_API_KEY');
  console.log('- ZEROENTROPY_PROJECT_ID');
});