const FormData = require('form-data');
const fs = require('fs');

// Read the audio file and convert to base64 (like React Native does)
const audioPath = '/Users/amyzhou/RAGrecording/backend/audio_files/2025-09/6f984674-3ff2-48c8-a304-b9c2be228343_1756686027065.wav';
const audioBuffer = fs.readFileSync(audioPath);
const base64Audio = audioBuffer.toString('base64');

console.log('Base64 length:', base64Audio.length);

// Create FormData exactly like React Native would
const formData = new FormData();

// React Native creates a data URI like this:
const dataUri = `data:audio/wav;base64,${base64Audio}`;

// But we need to convert it back to a proper file for curl
// Let's create the POST body that mimics what React Native sends

console.log('Data URI length:', dataUri.length);
console.log('Data URI start:', dataUri.substring(0, 100));