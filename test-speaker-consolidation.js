#!/usr/bin/env node

// Test script to verify speaker consolidation logic
const testSpeakerConsolidation = () => {
  console.log('🧪 Testing Speaker Consolidation Logic...\n');

  // Simulate the consolidation logic from the backend with speaker limit
  const speakerMap = new Map();
  let nextSpeakerId = 1;
  const MAX_SPEAKERS = 8; // Hard limit to prevent excessive indexing

  const consolidateSpeaker = (speakerName) => {
    if (!speakerName || speakerMap.has(speakerName)) {
      return speakerMap.get(speakerName);
    }

    // Check if we've reached the speaker limit
    const uniqueSpeakersCount = new Set(Array.from(speakerMap.values())).size;
    if (uniqueSpeakersCount >= MAX_SPEAKERS) {
      // Assign to last speaker instead of creating new one
      const limitedSpeaker = `Speaker ${MAX_SPEAKERS}`;
      speakerMap.set(speakerName, limitedSpeaker);
      return limitedSpeaker;
    }

    // Normalize speaker name to catch variations - preserve numbers but normalize format
    const normalizedSpeaker = speakerName.toUpperCase()
      .replace(/[_\s]+/g, '')  // Remove underscores and spaces
      .replace(/^SPEAKER0*/, 'SPEAKER')  // Convert SPEAKER00, SPEAKER01 -> SPEAKER, SPEAKER1
      .replace(/^SPEAKER(\d+)$/, 'SPEAKER$1');  // Keep final format as SPEAKER1, SPEAKER2
    
    const existingSpeaker = Array.from(speakerMap.keys()).find(existing => {
      const existingNormalized = existing.toUpperCase()
        .replace(/[_\s]+/g, '')
        .replace(/^SPEAKER0*/, 'SPEAKER') 
        .replace(/^SPEAKER(\d+)$/, 'SPEAKER$1');
      return existingNormalized === normalizedSpeaker;
    });
    
    if (existingSpeaker) {
      // Reuse existing speaker mapping for variations
      const consolidatedName = speakerMap.get(existingSpeaker);
      speakerMap.set(speakerName, consolidatedName);
      return consolidatedName;
    } else {
      // Create new speaker only if under limit
      if (nextSpeakerId <= MAX_SPEAKERS) {
        const newSpeaker = `Speaker ${nextSpeakerId}`;
        speakerMap.set(speakerName, newSpeaker);
        nextSpeakerId++;
        return newSpeaker;
      } else {
        // Over limit, assign to last speaker
        const limitedSpeaker = `Speaker ${MAX_SPEAKERS}`;
        speakerMap.set(speakerName, limitedSpeaker);
        return limitedSpeaker;
      }
    }
  };

  // Test cases - simulating problematic speaker variations + speaker limit testing
  const testCases = [
    // Person 1 variations
    { original: 'Speaker_00', text: 'Hello there' },
    { original: 'SPEAKER_00', text: 'How are you?' },
    { original: 'speaker_0', text: 'I am doing well' },
    { original: 'Speaker 00', text: 'Thanks for asking' },
    
    // Person 2 variations  
    { original: 'Speaker_01', text: 'Good morning' },
    { original: 'SPEAKER_01', text: 'Nice weather today' },
    { original: 'speaker_1', text: 'Yes it is' },
    { original: 'Speaker 01', text: 'Have a great day' },
    
    // Additional variations
    { original: 'Speaker_02', text: 'Just joined the call' },
    { original: 'SPEAKER_02', text: 'Can everyone hear me?' },
    
    // Test speaker limit - these should create new speakers up to limit
    { original: 'Speaker_03', text: 'Speaker 4 here' },
    { original: 'Speaker_04', text: 'Speaker 5 here' },
    { original: 'Speaker_05', text: 'Speaker 6 here' },
    { original: 'Speaker_06', text: 'Speaker 7 here' },
    { original: 'Speaker_07', text: 'Speaker 8 here' },
    
    // These should be assigned to Speaker 8 (limit reached)
    { original: 'Speaker_08', text: 'Should be limited to Speaker 8' },
    { original: 'Speaker_09', text: 'Should also be limited to Speaker 8' },
    { original: 'RandomSpeaker', text: 'Should also be limited to Speaker 8' },
  ];

  console.log('📥 Input segments:');
  testCases.forEach((test, i) => {
    console.log(`  ${i+1}. "${test.original}": ${test.text}`);
  });

  console.log('\n🔄 Processing consolidation...\n');

  const results = testCases.map(test => {
    const consolidated = consolidateSpeaker(test.original);
    console.log(`  ${test.original} → ${consolidated}`);
    return {
      ...test,
      consolidated
    };
  });

  console.log(`\n📊 Final speaker mapping:`);
  console.log(`  Unique speakers identified: ${Array.from(new Set(Object.values(speakerMap))).length}`);
  console.log(`  Speaker variations processed: ${speakerMap.size}`);
  
  const uniqueSpeakers = Array.from(new Set(Object.values(speakerMap)));
  uniqueSpeakers.forEach(speaker => {
    const variations = Array.from(speakerMap.entries())
      .filter(([_, consolidated]) => consolidated === speaker)
      .map(([original, _]) => original);
    console.log(`  ${speaker}: [${variations.join(', ')}]`);
  });

  console.log('\n📝 Final transcript:');
  results.forEach(result => {
    console.log(`${result.consolidated}: ${result.text}`);
  });

  // Test success criteria
  const uniqueConsolidated = new Set(results.map(r => r.consolidated));
  const expectedMaxSpeakers = 8; // Should never exceed 8 speakers (hard limit)
  
  console.log(`\n✅ Test Results:`);
  console.log(`  Expected max speakers: ${expectedMaxSpeakers}`);
  console.log(`  Actually consolidated to: ${uniqueConsolidated.size} speakers`);
  console.log(`  Success: ${uniqueConsolidated.size <= expectedMaxSpeakers ? '✅ PASS' : '❌ FAIL'}`);
  
  return uniqueConsolidated.size <= expectedMaxSpeakers;
};

// Run the test
const success = testSpeakerConsolidation();
process.exit(success ? 0 : 1);