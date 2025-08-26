import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

class AudioRecordingService {
  private recording: Audio.Recording | null = null;
  private recordingUri: string | null = null;

  async initialize() {
    try {
      console.log('AudioRecordingService: Requesting permissions...');
      const { status } = await Audio.requestPermissionsAsync();
      console.log('Permission status:', status);
      
      if (status !== 'granted') {
        throw new Error('Audio recording permission not granted');
      }

      console.log('Setting audio mode...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: true, // Enable background recording
      });
      console.log('Audio mode set successfully');
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      throw error;
    }
  }

  async startRecording(): Promise<void> {
    try {
      console.log('AudioRecordingService: startRecording called');
      
      // Always clean up any existing recording first
      await this.cleanup();

      console.log('Initializing audio...');
      await this.initialize();

      console.log('Creating recording with preset...');
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      this.recording = recording;
      console.log('Recording started successfully');
    } catch (error) {
      console.error('Failed to start recording:', error);
      // Ensure cleanup on error
      await this.cleanup();
      throw error;
    }
  }

  // Helper method to properly clean up recording resources
  private async cleanup(): Promise<void> {
    try {
      if (this.recording) {
        console.log('Cleaning up existing recording...');
        const status = await this.recording.getStatusAsync();
        
        if (status.isRecording) {
          console.log('Stopping active recording...');
          await this.recording.stopAndUnloadAsync();
        } else if (status.isDoneRecording) {
          console.log('Unloading completed recording...');
          await this.recording.unloadAsync();
        }
        
        this.recording = null;
        console.log('Recording cleanup completed');
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
      // Force reset even if cleanup fails
      this.recording = null;
    }
  }

  async stopRecording(): Promise<string | null> {
    try {
      console.log('AudioRecordingService: stopRecording called');
      
      if (!this.recording) {
        console.log('No recording in progress');
        return null;
      }

      let uri: string | null = null;
      
      try {
        const status = await this.recording.getStatusAsync();
        if (status.isRecording) {
          console.log('Stopping and unloading recording...');
          await this.recording.stopAndUnloadAsync();
          uri = this.recording.getURI();
          this.recordingUri = uri;
        } else {
          console.log('Recording not active, getting URI...');
          uri = this.recording.getURI();
          this.recordingUri = uri;
        }
      } catch (error) {
        console.error('Error stopping recording:', error);
      }

      // Always cleanup after stopping
      this.recording = null;
      console.log('Recording stopped, saved to:', uri);
      return uri;
    } catch (error) {
      console.error('Failed to stop recording:', error);
      // Ensure cleanup even on error
      this.recording = null;
      return null;
    }
  }

  async getRecordingBase64(): Promise<string | null> {
    try {
      if (!this.recordingUri) {
        console.log('No recording URI available');
        return null;
      }

      const base64 = await FileSystem.readAsStringAsync(this.recordingUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return base64;
    } catch (error) {
      console.error('Failed to get recording data:', error);
      return null;
    }
  }

  getRecordingUri(): string | null {
    return this.recordingUri;
  }

  isRecording(): boolean {
    return this.recording !== null;
  }
}

export default new AudioRecordingService();