import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

class AudioRecordingService {
  private recording: Audio.Recording | null = null;
  private recordingUri: string | null = null;

  async initialize() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Audio recording permission not granted');
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      throw error;
    }
  }

  async startRecording(): Promise<void> {
    try {
      if (this.recording) {
        await this.stopRecording();
      }

      await this.initialize();

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      this.recording = recording;
      console.log('Recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  async stopRecording(): Promise<string | null> {
    try {
      if (!this.recording) {
        console.log('No recording in progress');
        return null;
      }

      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      this.recordingUri = uri;
      this.recording = null;

      console.log('Recording stopped, saved to:', uri);
      return uri;
    } catch (error) {
      console.error('Failed to stop recording:', error);
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