import ZeroEntropy from 'zeroentropy';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const animalTranscripts = [
  "I saw a dolphin today at the aquarium. They're incredibly intelligent marine mammals that use echolocation to navigate and hunt. Did you know they can recognize themselves in mirrors?",
  "The elephant at the zoo was amazing. These gentle giants have incredible memories and can remember other elephants for decades. They also mourn their dead and have complex social structures.",
  "Watched a documentary about octopuses last night. They have three hearts and blue blood. Their problem-solving abilities are off the charts - they can open jars from the inside!",
  "My neighbor's parrot can speak over 100 words. African Grey parrots are known to have the intelligence of a 5-year-old child. They can actually understand context, not just mimic.",
  "Saw a video of a mantis shrimp today. They have the most complex eyes in the animal kingdom with 16 color receptors. Humans only have 3! They can also punch with the force of a bullet.",
  "The cheetah is the fastest land animal, reaching speeds up to 70 mph. But they can only maintain that speed for about 30 seconds before overheating.",
  "Penguins are fascinating. Emperor penguins can dive to depths of over 500 meters and hold their breath for more than 20 minutes. The males incubate eggs on their feet for two months in Antarctic winter.",
  "Just learned that crows can hold grudges for years and pass this information to their offspring. They can recognize human faces and will remember if you've been mean to them.",
  "Honeybees communicate through dance. The waggle dance tells other bees exactly where to find flowers - distance, direction, and even quality of the nectar source.",
  "Giraffes only sleep for 30 minutes a day on average. Their long necks have the same number of vertebrae as humans - just seven, but each one is huge!",
  "Axolotls are incredible. They can regenerate entire limbs, organs, and even parts of their brain. Scientists are studying them to understand regeneration in humans.",
  "Tardigrades, or water bears, are virtually indestructible. They can survive extreme temperatures, radiation, and even the vacuum of space. They've been around for 500 million years.",
  "The blue whale's heart alone weighs as much as a small car - about 400 pounds. Their heartbeat can be detected from two miles away underwater.",
  "Flamingos are pink because of their diet. They eat algae and brine shrimp that contain carotenoid pigments. Baby flamingos are actually born gray or white.",
  "Sloths only defecate once a week and lose up to 30% of their body weight when they do. They climb down from trees to do this, which is when they're most vulnerable to predators.",
  "Platypuses are one of only two mammals that lay eggs. They also don't have nipples - they sweat milk through their skin for their babies to lick off.",
  "Arctic foxes can survive temperatures as low as -70°C. Their fur changes color with the seasons - white in winter for camouflage in snow, brown/gray in summer.",
  "Naked mole rats are immune to cancer and can live for over 30 years. They don't feel pain from acid and can survive 18 minutes without oxygen.",
  "Pistol shrimp can create bubbles that reach temperatures nearly as hot as the sun's surface when they snap their claws. The sound can reach 218 decibels, louder than a gunshot.",
  "Hummingbirds are the only birds that can fly backwards. Their hearts beat up to 1,260 times per minute, and they need to eat every 10-15 minutes to survive."
];

const animalNames = [
  "dolphin", "elephant", "octopus", "parrot", "mantis-shrimp",
  "cheetah", "penguin", "crow", "honeybee", "giraffe",
  "axolotl", "tardigrade", "blue-whale", "flamingo", "sloth",
  "platypus", "arctic-fox", "naked-mole-rat", "pistol-shrimp", "hummingbird"
];

async function pushAllAnimalsToZeroEntropy() {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  
  if (!apiKey || !apiKey.startsWith('ze_')) {
    console.error('Invalid ZeroEntropy API key');
    return;
  }

  console.log('Initializing ZeroEntropy client...');
  
  const client = new ZeroEntropy({
    apiKey: apiKey,
  });

  const collectionName = 'ai-wearable-transcripts';
  let successCount = 0;
  let failCount = 0;

  console.log(`\nPushing ${animalTranscripts.length} animal transcripts to ZeroEntropy...\n`);

  for (let i = 0; i < animalTranscripts.length; i++) {
    const text = animalTranscripts[i];
    const animalName = animalNames[i];
    const timestamp = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000); // Random time in past week
    
    try {
      const documentPath = `animal-facts/${animalName}-${uuidv4()}.txt`;
      
      console.log(`[${i + 1}/${animalTranscripts.length}] Pushing ${animalName}...`);
      
      await client.documents.add({
        collection_name: collectionName,
        path: documentPath,
        content: {
          type: 'text',
          text: text,
        },
        metadata: {
          topic: animalName,
          category: "animal-facts",
          recordingId: `recording-${i + 1}`,
          timestamp: timestamp.toISOString(),
          source: "ai-wearable-companion",
          index: i.toString(),
        },
        overwrite: false,
      });
      
      console.log(`  ✅ Success: ${animalName}`);
      successCount++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error: any) {
      console.error(`  ❌ Failed: ${animalName} - ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  ✅ Successfully pushed: ${successCount} transcripts`);
  console.log(`  ❌ Failed: ${failCount} transcripts`);
  console.log(`\n🎉 All animal transcripts have been processed!`);
  
  // Now let's verify by getting the list
  try {
    console.log('\nVerifying documents in collection...');
    const docs = await client.documents.getInfoList({
      collection_name: collectionName,
      limit: 25,
    });
    
    console.log(`Found ${(docs as any).documents?.length || 0} documents in collection`);
  } catch (error: any) {
    console.log('Could not verify documents:', error.message);
  }
}

// Run the script
console.log('Starting to push all animal transcripts to ZeroEntropy...');
pushAllAnimalsToZeroEntropy();