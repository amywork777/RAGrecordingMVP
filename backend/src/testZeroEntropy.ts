import ZeroEntropy from 'zeroentropy';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

async function testZeroEntropyPush() {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  
  if (!apiKey || !apiKey.startsWith('ze_')) {
    console.error('Invalid ZeroEntropy API key');
    return;
  }

  console.log('Initializing ZeroEntropy client...');
  console.log('API Key:', apiKey.substring(0, 15) + '...');
  
  const client = new ZeroEntropy({
    apiKey: apiKey,
  });

  // Sample animal transcript to push
  const animalTranscript = {
    text: "Just learned about axolotls - they're absolutely fascinating! These Mexican salamanders can regenerate entire limbs, organs, and even parts of their brain and heart. Scientists are studying them intensively to understand regeneration in humans. They remain aquatic their entire lives and are critically endangered in the wild, found only in Lake Xochimilco near Mexico City.",
    metadata: {
      topic: "axolotl",
      category: "animal-facts",
      recordingId: "test-recording-001",
      timestamp: new Date().toISOString(),
      source: "ai-wearable-companion"
    }
  };

  try {
    // First, let's check if we have any collections
    console.log('\n1. Getting collections...');
    const collections = await client.collections.getList({});
    console.log('Collections response:', collections);
    
    let collectionName = 'ai-wearable-transcripts';
    
    // Check if collection exists, if not create it
    const collectionNames = (collections as any).collection_names || [];
    
    if (!collectionNames.includes(collectionName)) {
      console.log('\n2. Creating new collection:', collectionName);
      try {
        const newCollection = await client.collections.add({
          collection_name: collectionName,
        });
        console.log('Created collection:', newCollection);
      } catch (error: any) {
        console.log('Error creating collection:', error.message);
        if (error.error) {
          console.log('Error details:', error.error);
        }
      }
    } else {
      console.log('\n2. Collection already exists:', collectionName);
    }
    
    // Now push the document
    console.log('\n3. Pushing animal transcript to ZeroEntropy...');
    console.log('Collection:', collectionName);
    console.log('Text preview:', animalTranscript.text.substring(0, 100) + '...');
    
    const documentPath = `animal-facts/${uuidv4()}.txt`;
    
    const result = await client.documents.add({
      collection_name: collectionName,
      path: documentPath,
      content: {
        type: 'text',
        text: animalTranscript.text,
      },
      metadata: {
        topic: animalTranscript.metadata.topic,
        category: animalTranscript.metadata.category,
        recordingId: animalTranscript.metadata.recordingId,
        timestamp: animalTranscript.metadata.timestamp,
        source: animalTranscript.metadata.source,
      },
      overwrite: false,
    });
    
    console.log('\n✅ Success! Document pushed to ZeroEntropy');
    console.log('Document path:', documentPath);
    console.log('Response:', result);
    
    // Try to get info about the document
    console.log('\n4. Getting document info...');
    const docInfo = await client.documents.getInfo({
      collection_name: collectionName,
      path: documentPath,
      include_content: true,
    });
    
    console.log('Document info:', JSON.stringify(docInfo, null, 2));
    
  } catch (error: any) {
    console.error('\n❌ Error with ZeroEntropy:');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    
    if (error.status) {
      console.error('HTTP Status:', error.status);
    }
    
    if (error.error) {
      console.error('Error details:', error.error);
    }
    
    if (error.response) {
      console.error('Response:', error.response);
    }
    
    console.log('\n📝 Debugging info:');
    console.log('API Key format: ze_XXXXXXXXX');
    console.log('Your key starts with:', apiKey.substring(0, 3));
  }
}

// Run the test
console.log('Starting ZeroEntropy test...');
console.log('Organization ID: org-9e338660-abe5-4375-b9e0-27357453f67d');
testZeroEntropyPush();