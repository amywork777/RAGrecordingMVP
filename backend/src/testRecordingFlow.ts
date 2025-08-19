import dotenv from 'dotenv';
dotenv.config();

import ZeroEntropy from 'zeroentropy';
import { v4 as uuidv4 } from 'uuid';

async function testRecordingFlow() {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  
  if (!apiKey || !apiKey.startsWith('ze_')) {
    console.error('Invalid ZeroEntropy API key');
    return;
  }

  console.log('Testing recording flow...');
  console.log('API Key:', apiKey.substring(0, 10) + '...');
  
  const client = new ZeroEntropy({ apiKey });
  const documentId = uuidv4();
  const testTranscription = "This is a test recording. I'm talking about technology and user interfaces. The system should be intuitive and easy to use.";
  
  try {
    console.log('\n1. Storing transcription in ZeroEntropy...');
    
    await client.documents.add({
      collection_name: 'ai-wearable-transcripts',
      path: `recordings/test-${documentId}.txt`,
      content: {
        type: 'text',
        text: testTranscription,
      },
      metadata: {
        recordingId: `test-${documentId}`,
        timestamp: new Date().toISOString(),
        source: 'test-script',
        category: 'user-recording',
      },
    });
    
    console.log('✅ Document stored successfully!');
    console.log('Document ID:', documentId);
    
    // Wait a bit for indexing
    console.log('\n2. Waiting for indexing...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Search for it
    console.log('\n3. Searching for the transcription...');
    const searchResults = await client.queries.topDocuments({
      collection_name: 'ai-wearable-transcripts',
      query: 'technology user interfaces intuitive',
      k: 5,
      include_metadata: true,
    });
    
    console.log('\n4. Search results:');
    const results = (searchResults as any).results || [];
    
    const found = results.find((r: any) => r.path.includes(documentId));
    if (found) {
      console.log('✅ Found our test recording!');
      console.log('Path:', found.path);
      console.log('Score:', found.score);
    } else {
      console.log('❌ Test recording not found in results');
      console.log('Total results:', results.length);
      if (results.length > 0) {
        console.log('First result path:', results[0].path);
      }
    }
    
  } catch (error: any) {
    console.error('\n❌ Error in test flow:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testRecordingFlow().then(() => {
  console.log('\nTest complete!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});