import { BleManager, Device, Characteristic, BleError } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';

interface FileInfo {
  size: number;
  name: string;
}

class BLEFileTransferService {
  private manager: BleManager;
  private device: Device | null = null;
  private receivedData: Uint8Array = new Uint8Array();
  private expectedSeq: number = 0;
  private packetBuffer: Map<number, Uint8Array> = new Map();
  private fileSize: number = 0;
  private fileName: string = '';
  private transferComplete: boolean = false;
  private credits: number = 0;
  private totalPackets: number = 0;
  
  // UUIDs from hardware
  private readonly SERVICE_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0001';
  private readonly TX_DATA_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0002';
  private readonly RX_CREDITS_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0003';
  private readonly FILE_INFO_UUID = 'a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0004';

  constructor() {
    this.manager = new BleManager();
  }

  async initialize(): Promise<void> {
    const state = await this.manager.state();
    if (state !== 'PoweredOn') {
      await new Promise<void>((resolve) => {
        const subscription = this.manager.onStateChange((newState) => {
          if (newState === 'PoweredOn') {
            subscription.remove();
            resolve();
          }
        });
      });
    }
  }

  async scanForDevices(timeout: number = 10000): Promise<Device[]> {
    console.log('BLE: Starting scan for XIAO-REC devices...');
    await this.initialize();
    
    const devices: Device[] = [];
    const deviceMap = new Map<string, Device>();
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.log(`BLE: Scan timeout after ${timeout}ms`);
        this.manager.stopDeviceScan();
        resolve(Array.from(deviceMap.values()));
      }, timeout);

      this.manager.startDeviceScan(
        null,
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error('BLE: Scan error:', error);
            clearTimeout(timeoutId);
            this.manager.stopDeviceScan();
            reject(error);
            return;
          }

          if (device) {
            console.log(`BLE: Discovered device: ${device.name || 'Unknown'} (${device.id})`);
            
            if (device.name === 'XIAO-REC' || 
                device.name?.includes('XIAO') || 
                device.name?.includes('REC')) {
              
              if (!deviceMap.has(device.id)) {
                console.log(`BLE: ✓ Found XIAO device: ${device.name} (${device.id})`);
                deviceMap.set(device.id, device);
                devices.push(device);
              }
            }
          }
        }
      );
    });
  }

  async connect(device: Device): Promise<boolean> {
    try {
      console.log(`BLE: Connecting to ${device.name} (${device.id})...`);
      
      this.device = await this.manager.connectToDevice(device.id);
      console.log('BLE: Connected, discovering services...');
      
      await this.device.discoverAllServicesAndCharacteristics();
      console.log('BLE: Services discovered');
      
      this.reset();
      
      return true;
    } catch (error) {
      console.error('BLE: Connection failed:', error);
      this.device = null;
      return false;
    }
  }

  async readFileInfo(): Promise<FileInfo> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    try {
      console.log('BLE: Reading file info...');
      const characteristic = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.FILE_INFO_UUID
      );
      
      if (!characteristic.value) {
        throw new Error('No data received from file info characteristic');
      }
      const data = Buffer.from(characteristic.value, 'base64');
      
      this.fileSize = data.readUInt32LE(0);
      const nameBytes = data.slice(4);
      
      const nullIndex = nameBytes.indexOf(0);
      if (nullIndex >= 0) {
        this.fileName = nameBytes.slice(0, nullIndex).toString('utf8');
      } else {
        this.fileName = nameBytes.toString('utf8');
      }
      
      console.log(`BLE: File info - Name: ${this.fileName}, Size: ${this.fileSize} bytes`);
      
      return { size: this.fileSize, name: this.fileName };
    } catch (error) {
      console.error('BLE: Failed to read file info:', error);
      throw error;
    }
  }

  private crc16_ccitt(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let b = 0; b < 8; b++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc;
  }

  async sendCredits(numCredits: number): Promise<void> {
    if (!this.device) return;
    
    try {
      const data = Buffer.from([numCredits]);
      await this.device.writeCharacteristicWithoutResponseForService(
        this.SERVICE_UUID,
        this.RX_CREDITS_UUID,
        data.toString('base64')
      );
      this.credits += numCredits;
    } catch (error) {
      console.error('BLE: Failed to send credits:', error);
    }
  }

  private processBufferedPackets(): void {
    while (this.packetBuffer.has(this.expectedSeq)) {
      const payload = this.packetBuffer.get(this.expectedSeq)!;
      this.packetBuffer.delete(this.expectedSeq);
      this.receivedData = this.appendData(this.receivedData, payload);
      this.expectedSeq++;
    }
    
    // Clean up old packets if buffer too large
    if (this.packetBuffer.size > 100) {
      const sortedKeys = Array.from(this.packetBuffer.keys()).sort((a, b) => a - b);
      const cutoff = sortedKeys[sortedKeys.length - 50];
      for (const [seq] of this.packetBuffer) {
        if (seq < cutoff) {
          this.packetBuffer.delete(seq);
        }
      }
    }
  }

  private appendData(current: Uint8Array, payload: Uint8Array): Uint8Array {
    const newData = new Uint8Array(current.length + payload.length);
    newData.set(current);
    newData.set(payload, current.length);
    return newData;
  }

  private async handleNotification(data: Uint8Array): Promise<void> {
    if (data.length < 8) {
      return;
    }
    
    // Parse packet exactly like Python
    const seq = Buffer.from(data.slice(0, 4)).readUInt32LE();
    const length = Buffer.from(data.slice(4, 6)).readUInt16LE();
    const crcReceived = Buffer.from(data.slice(6, 8)).readUInt16LE();
    const payload = data.slice(8, 8 + length);
    
    // EOF packet
    if (length === 0 && crcReceived === 0) {
      console.log(`\n✓ EOF packet received (seq ${seq}) - transfer complete!`);
      this.transferComplete = true;
      return;
    }
    
    if (payload.length !== length) {
      return;
    }
    
    // Verify CRC but don't reject packet
    const crcCalculated = this.crc16_ccitt(payload);
    if (crcReceived !== crcCalculated) {
      console.log(`\nCRC error on packet ${seq}`);
    }
    
    this.totalPackets++;
    
    // Handle ordering exactly like Python
    if (seq < this.expectedSeq) {
      return; // Old packet
    } else if (seq === this.expectedSeq) {
      this.receivedData = this.appendData(this.receivedData, payload);
      this.expectedSeq++;
      this.processBufferedPackets();
    } else {
      // Buffer out-of-order packet
      if (!this.packetBuffer.has(seq)) {
        this.packetBuffer.set(seq, payload);
        
        // Only log and handle large gaps like Python
        if (seq - this.expectedSeq > 50) {
          console.log(`\n⚠ Large gap: expected ${this.expectedSeq}, got ${seq}`);
          const availableSeqs = Array.from(this.packetBuffer.keys())
            .filter(s => s >= this.expectedSeq)
            .sort((a, b) => a - b);
          
          if (availableSeqs.length > 0) {
            const nextSeq = availableSeqs[0];
            if (nextSeq - this.expectedSeq <= 10) {
              console.log(`  Skipping to packet ${nextSeq}`);
              this.expectedSeq = nextSeq;
              this.processBufferedPackets();
            }
          }
        }
      }
    }
    
    // Send credits exactly like Python - every 2 packets
    if (this.totalPackets % 2 === 0) {
      await this.sendCredits(2);
    }
  }

  async downloadFile(onProgress?: (percent: number) => void): Promise<Uint8Array> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    console.log('BLE: Starting file download...');
    
    // Reset state
    this.receivedData = new Uint8Array();
    this.expectedSeq = 0;
    this.totalPackets = 0;
    this.credits = 0;
    this.transferComplete = false;
    this.packetBuffer.clear();
    
    const startTime = Date.now();
    let lastReceived = 0;
    let stallCount = 0;
    let lastProgress = 0;
    
    return new Promise((resolve, reject) => {
      // Subscribe to notifications
      this.device!.monitorCharacteristicForService(
        this.SERVICE_UUID,
        this.TX_DATA_UUID,
        async (error, characteristic) => {
          if (error) {
            console.error('BLE: Notification error:', error);
            reject(error);
            return;
          }
          
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, 'base64');
            await this.handleNotification(new Uint8Array(data));
            
            // Progress update throttled
            const progress = (this.receivedData.length / this.fileSize) * 100;
            if (progress - lastProgress > 0.1) {
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = this.receivedData.length / elapsed;
              console.log(`\rPacket ${this.expectedSeq}: ${this.receivedData.length}/${this.fileSize} bytes ` +
                         `(${progress.toFixed(1)}%) - ${(speed/1024).toFixed(1)} KB/s [${this.packetBuffer.size} buffered]`);
              
              if (onProgress) onProgress(Math.min(progress, 100));
              lastProgress = progress;
            }
            
            // Check completion
            if (this.transferComplete || this.receivedData.length >= this.fileSize) {
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = this.receivedData.length / elapsed;
              console.log(`\n✓ Download complete: ${this.receivedData.length} bytes in ${this.totalPackets} packets`);
              console.log(`  Average speed: ${(speed/1024).toFixed(1)} KB/s`);
              console.log(`  Total time: ${elapsed.toFixed(1)} seconds`);
              if (onProgress) onProgress(100);
              resolve(this.receivedData);
            }
          }
        }
      );
      
      // Send initial credits and start monitoring
      this.sendCredits(64).then(() => {
        console.log('✓ Sent initial credits (64)');
        
        // Stall detection exactly like Python
        const stallCheck = setInterval(async () => {
          if (this.receivedData.length === lastReceived) {
            stallCount++;
            if (stallCount > 20) {
              const progress = (this.receivedData.length / this.fileSize) * 100;
              if (progress >= 99.0) {
                console.log(`\n✓ Transfer nearly complete at ${progress.toFixed(1)}% - accepting as done`);
                clearInterval(stallCheck);
                resolve(this.receivedData);
                return;
              }
              
              console.log(`\n⚠ Transfer stalled at ${this.receivedData.length} bytes (${progress.toFixed(1)}%)`);
              console.log(`   Buffer contains ${this.packetBuffer.size} out-of-order packets`);
              
              await this.sendCredits(32);
              stallCount = 0;
              
              if (this.packetBuffer.size > 0) {
                const minSeq = Math.min(...Array.from(this.packetBuffer.keys()));
                if (minSeq - this.expectedSeq <= 10) {
                  console.log(`   Skipping gap: ${this.expectedSeq} -> ${minSeq}`);
                  this.expectedSeq = minSeq;
                  this.processBufferedPackets();
                }
              }
            }
          } else {
            stallCount = 0;
            lastReceived = this.receivedData.length;
          }
        }, 500);
        
        // Timeout
        setTimeout(() => {
          if (!this.transferComplete && this.receivedData.length < this.fileSize) {
            clearInterval(stallCheck);
            if (this.receivedData.length === 0) {
              reject(new Error('Timeout: No data received'));
            } else {
              console.log('Timeout: Accepting partial transfer');
              resolve(this.receivedData);
            }
          }
        }, 60000);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        console.log('BLE: Disconnecting...');
        await this.device.cancelConnection();
        console.log('BLE: Disconnected');
      } catch (error) {
        console.error('BLE: Disconnect error:', error);
      }
      this.device = null;
    }
  }

  private reset(): void {
    this.receivedData = new Uint8Array();
    this.expectedSeq = 0;
    this.packetBuffer.clear();
    this.transferComplete = false;
    this.credits = 0;
    this.totalPackets = 0;
    this.fileSize = 0;
    this.fileName = '';
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  getDeviceInfo(): { name: string; id: string } | null {
    if (!this.device) return null;
    return {
      name: this.device.name || 'XIAO-REC',
      id: this.device.id
    };
  }
}

export default new BLEFileTransferService();