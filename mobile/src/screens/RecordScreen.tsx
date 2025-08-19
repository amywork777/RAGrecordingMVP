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
import uuid from 'react-native-uuid';

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

    return () => {
      BLEService.removeAllListeners();
    };
  }, [currentRecordingId]);

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

  const toggleRecording = () => {
    if (isRecording) {
      BLEService.stopAudioStream();
      setIsRecording(false);
      setCurrentRecordingId('');
    } else {
      const recordingId = uuid.v4() as string;
      setCurrentRecordingId(recordingId);
      BLEService.startAudioStream();
      setIsRecording(true);
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
        {!isConnected ? (
          <TouchableOpacity
            style={styles.connectButton}
            onPress={connectToDevice}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect to Device</Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordingActive]}
              onPress={toggleRecording}
            >
              <Text style={styles.buttonText}>
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnectDevice}
            >
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <ScrollView style={styles.transcriptContainer}>
        <Text style={styles.sectionTitle}>Live Transcription</Text>
        {transcripts.length === 0 ? (
          <Text style={styles.emptyText}>No transcripts yet. Start recording to see live transcription.</Text>
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  transcriptContainer: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
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