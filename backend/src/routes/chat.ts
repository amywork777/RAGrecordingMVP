import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import MockDataService from '../services/MockDataService';
import ZeroEntropyService from '../services/ZeroEntropyService';

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ChatWithTranscriptionRequest {
  transcriptionId: string;
  message: string;
}

// POST /api/chat/transcription
router.post('/transcription', async (req: Request, res: Response) => {
  try {
    const { transcriptionId, message }: ChatWithTranscriptionRequest = req.body;

    if (!transcriptionId || !message) {
      return res.status(400).json({ 
        error: 'transcriptionId and message are required' 
      });
    }

    console.log(`Chat request for transcription ID: ${transcriptionId}`);
    console.log(`User message: ${message}`);
    console.log(`OpenAI API key present: ${process.env.OPENAI_API_KEY ? 'YES' : 'NO'}`);

    // First, try to get the transcription from ZeroEntropy
    let transcriptionText = '';
    let transcriptionMetadata: any = {};
    
    try {
      // Get document from ZeroEntropy
      const document = await ZeroEntropyService.getDocumentById(transcriptionId);
      if (document) {
        transcriptionText = document.text;
        transcriptionMetadata = document.metadata || {};
        console.log('Retrieved transcription from ZeroEntropy');
      }
    } catch (error) {
      console.log('ZeroEntropy retrieval failed, trying mock data...');
    }

    // Fallback to mock data if ZeroEntropy fails
    if (!transcriptionText) {
      try {
        const mockTranscripts = MockDataService.getAllTranscripts();
        const transcript = mockTranscripts.find((t: any) => 
          t.id === transcriptionId || t.recordingId === transcriptionId
        );
        
        if (transcript) {
          transcriptionText = transcript.text;
          transcriptionMetadata = {
            title: 'Mock Transcript',
            timestamp: transcript.timestamp,
            topic: 'General',
          };
          console.log('Retrieved transcription from mock data');
        }
      } catch (error) {
        console.error('Mock data retrieval failed:', error);
      }
    }

    if (!transcriptionText) {
      console.log('ERROR: Transcription not found for ID:', transcriptionId);
      return res.status(404).json({ 
        error: 'Transcription not found' 
      });
    }

    console.log(`Found transcription text (${transcriptionText.length} chars):`, transcriptionText.substring(0, 100) + '...');

    // Create a focused prompt for chatting with the specific transcription
    const systemPrompt = `You are an AI assistant helping users understand and discuss a specific transcription. 

Here is the transcription you should focus on:

Title: ${transcriptionMetadata.title || 'Untitled'}
Timestamp: ${transcriptionMetadata.timestamp || 'Unknown'}
Topic: ${transcriptionMetadata.topic || 'General'}

Transcription Text:
"${transcriptionText}"

Instructions:
- Answer questions specifically about this transcription
- Provide insights, summaries, and analysis based on the content
- If asked about topics not covered in this transcription, acknowledge that and redirect to what is covered
- Be conversational and helpful
- Keep responses concise but informative
- If the transcription is short or unclear, acknowledge limitations

User's question: "${message}"`;

    try {
      console.log('Calling OpenAI API for chat...');
      // Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const answer = completion.choices[0]?.message?.content || 
        'I apologize, but I couldn\'t generate a response about this transcription.';

      console.log('OpenAI response generated successfully');

      res.json({
        answer,
        transcriptionId,
        metadata: transcriptionMetadata,
      });

    } catch (error) {
      console.error('OpenAI API error:', error);
      
      // Fallback response
      const fallbackAnswer = `I can see this transcription is about: "${transcriptionText.substring(0, 100)}${transcriptionText.length > 100 ? '...' : ''}"

Regarding your question "${message}", I'm currently unable to provide a detailed analysis due to a temporary service issue. However, I can tell you this transcription appears to be ${transcriptionText.length < 100 ? 'a brief' : 'a detailed'} ${transcriptionMetadata.topic || 'discussion'}.

Please try asking again in a moment, or ask me to summarize the main points if you'd like.`;

      res.json({
        answer: fallbackAnswer,
        transcriptionId,
        metadata: transcriptionMetadata,
      });
    }

  } catch (error) {
    console.error('Chat with transcription error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to process chat request'
    });
  }
});

export default router;