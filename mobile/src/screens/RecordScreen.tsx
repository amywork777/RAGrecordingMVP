import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import BLEService from '../services/BLEService';
import APIService from '../services/APIService';
import AudioRecordingService from '../services/AudioRecordingService';
import uuid from 'react-native-uuid';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

interface Transcript {
  id: string;
  text: string;
  timestamp: Date;
}

export default function RecordScreen() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [currentRecordingId, setCurrentRecordingId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    BLEService.on('deviceConnected', handleDeviceConnected);
    BLEService.on('deviceDisconnected', handleDeviceDisconnected);
    BLEService.on('audioChunk', handleAudioChunk);

    // Load existing transcripts from backend on mount
    loadTranscriptsFromBackend();

    return () => {
      BLEService.removeAllListeners();
    };
  }, [currentRecordingId]);

  const loadTranscriptsFromBackend = async () => {
    try {
      console.log('Loading transcripts from backend...');
      const recentTranscripts = await APIService.getRecentTranscripts(50); // Get more transcripts
      
      if (recentTranscripts && recentTranscripts.length > 0) {
        const formattedTranscripts: Transcript[] = recentTranscripts.map((t: any) => ({
          id: t.id,
          text: t.text,
          timestamp: new Date(t.timestamp),
        }));
        
        setTranscripts(formattedTranscripts);
        console.log(`Loaded ${formattedTranscripts.length} transcripts from backend`);
      }
    } catch (error) {
      console.error('Error loading transcripts:', error);
    }
  };

  const handleDeviceConnected = () => {
    setIsConnected(true);
    Alert.alert('Connected', 'Successfully connected to AI Wearable');
  };

  const handleDeviceDisconnected = () => {
    setIsConnected(false);
    setIsRecording(false);
    Alert.alert('Disconnected', 'Disconnected from AI Wearable');
  };

  const handleAudioChunk = async (audioData: ArrayBuffer) => {
    if (!currentRecordingId) return;

    try {
      const response = await APIService.sendAudioChunk(audioData, currentRecordingId);
      
      if (response.transcription) {
        const newTranscript: Transcript = {
          id: uuid.v4() as string,
          text: response.transcription,
          timestamp: new Date(response.timestamp),
        };
        
        setTranscripts(prev => [...prev, newTranscript]);
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  };

  const connectToDevice = async () => {
    setIsLoading(true);
    try {
      const devices = await BLEService.scanForDevices();
      if (devices.length > 0) {
        await BLEService.connectToDevice(devices[0].id);
      } else {
        Alert.alert('No Devices', 'No AI Wearable devices found');
      }
    } catch (error) {
      Alert.alert('Connection Error', 'Failed to connect to device');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectDevice = async () => {
    try {
      await BLEService.disconnectDevice();
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      try {
        setIsLoading(true);
        
        // Stop the recording and get the audio file URI
        const audioUri = await AudioRecordingService.stopRecording();
        
        if (audioUri) {
          // Get the audio data as base64
          const base64Audio = await AudioRecordingService.getRecordingBase64();
          
          if (base64Audio) {
            // Send to backend for transcription
            const response = await APIService.sendAudioBase64(base64Audio, currentRecordingId);
            
            if (response.transcription) {
              console.log('Transcription received:', response.transcription);
              
              // The backend will store it in ZeroEntropy
              // Reload transcripts to show the new one
              setTimeout(loadTranscriptsFromBackend, 2000);
            }
          }
        }
      } catch (error) {
        console.error('Failed to stop recording:', error);
        Alert.alert('Error', 'Failed to process recording');
      } finally {
        setIsLoading(false);
        setIsRecording(false);
        setCurrentRecordingId('');
      }
    } else {
      // Start recording
      try {
        const recordingId = uuid.v4() as string;
        setCurrentRecordingId(recordingId);
        
        await AudioRecordingService.startRecording();
        setIsRecording(true);
        console.log('Audio recording started');
      } catch (error) {
        console.error('Failed to start recording:', error);
        Alert.alert('Recording Error', 'Failed to start recording. Please check microphone permissions.');
        setIsRecording(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Wearable Recorder</Text>
        <View style={styles.connectionStatus}>
          <View style={[styles.statusDot, isConnected ? styles.connected : styles.disconnected]} />
          <Text style={styles.statusText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordingActive]}
          onPress={toggleRecording}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </Text>
          )}
        </TouchableOpacity>
        
        {isRecording && (
          <Text style={styles.recordingIndicator}>Recording in progress...</Text>
        )}

        {/* Upload Text to ZeroEntropy */}
        <TouchableOpacity
          style={styles.uploadButton}
          onPress={async () => {
            try {
              const pick = await DocumentPicker.getDocumentAsync({
                type: 'text/plain',
                multiple: false,
                copyToCacheDirectory: true,
              });
              if (pick.canceled || !pick.assets || pick.assets.length === 0) {
                return;
              }
              const asset = pick.assets[0];
              const uri = asset.uri;
              const filename = asset.name || `upload-${Date.now()}.txt`;

              const fileContent = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
              const result = await APIService.uploadTextDocument(fileContent, {
                path: `mobile/uploads/${filename}`,
                metadata: { source: 'mobile', filename },
                collectionName: 'ai-wearable-transcripts',
              });
              Alert.alert('Uploaded', `Uploaded ${filename} to ZeroEntropy`);
              console.log('Upload result:', result);
              loadTranscriptsFromBackend();
            } catch (e: any) {
              console.error('Upload failed:', e);
              Alert.alert('Upload Failed', e?.message || 'Unknown error');
            }
          }}
        >
          <Text style={styles.buttonText}>Upload Text</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.transcriptContainer}>
        <View style={styles.transcriptHeader}>
          <Text style={styles.sectionTitle}>All Transcripts</Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={loadTranscriptsFromBackend}
          >
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
        {transcripts.length === 0 ? (
          <Text style={styles.emptyText}>No transcripts yet. Loading from storage...</Text>
        ) : (
          transcripts.map((transcript) => (
            <View key={transcript.id} style={styles.transcriptItem}>
              <Text style={styles.transcriptTime}>
                {transcript.timestamp.toLocaleTimeString()}
              </Text>
              <Text style={styles.transcriptText}>{transcript.text}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  connected: {
    backgroundColor: '#4CAF50',
  },
  disconnected: {
    backgroundColor: '#f44336',
  },
  statusText: {
    color: '#fff',
    fontSize: 16,
  },
  controls: {
    padding: 20,
    alignItems: 'center',
  },
  connectButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center',
  },
  recordButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center',
    marginBottom: 10,
  },
  recordingActive: {
    backgroundColor: '#f44336',
  },
  disconnectButton: {
    backgroundColor: '#757575',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center',
  },
  uploadButton: {
    backgroundColor: '#6A5ACD',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  recordingIndicator: {
    color: '#f44336',
    fontSize: 14,
    marginTop: 10,
    fontWeight: 'bold',
  },
  transcriptContainer: {
    flex: 1,
    padding: 20,
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 15,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
  transcriptItem: {
    backgroundColor: '#fff',
    padding: 15,
    marginBottom: 10,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  transcriptTime: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
  },
  transcriptText: {
    fontSize: 16,
    color: '#333',
  },
});