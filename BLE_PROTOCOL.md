# BLE Protocol Documentation: XIAO ⟷ React Native App

## Overview
The BLE protocol enables WAV file transfer from Arduino XIAO hardware to the React Native mobile app. The XIAO device acts as a BLE peripheral that advertises when ready to transfer, and the mobile app scans and connects as a BLE central.

## Hardware Workflow (Arduino XIAO)
1. **Recording**: Switch HIGH for >2s → Start recording to SD card
2. **Auto-Advertise**: Switch LOW → Stop recording + automatically start BLE advertising as "XIAO-REC"
3. **Transfer**: When app connects → Send WAV file via BLE packets
4. **Complete**: Transfer done → Stop advertising, return to idle

## Mobile App Workflow (React Native)
1. **Auto-Sync**: User taps "Auto-Sync from XIAO" button
2. **Scan**: App scans for all BLE devices (10 second timeout)
3. **Filter**: Find devices named "XIAO-REC", "XIAO", or "REC" 
4. **Connect**: Auto-connect to first XIAO device found
5. **Download**: Receive WAV file via BLE protocol
6. **Process**: Save locally → Upload to backend → Transcribe → Add to UI

## BLE Service & Characteristics

### Service UUID
```
a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0001
```

### Characteristics

#### 1. TX_DATA (Notifications)
- **UUID**: `a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0002`
- **Properties**: Notify
- **Max Size**: 244 bytes
- **Purpose**: Arduino sends WAV file data packets to app

#### 2. RX_CREDITS (Write Without Response)  
- **UUID**: `a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0003`
- **Properties**: Write Without Response
- **Size**: 1 byte
- **Purpose**: App sends credits to Arduino for flow control

#### 3. FILE_INFO (Read)
- **UUID**: `a3f9b7f0-52d1-4c7a-8f1c-7a1b9b2f0004`
- **Properties**: Read
- **Max Size**: 64 bytes
- **Purpose**: Arduino provides file metadata [u32 size][name...]

## Packet Protocol

### Data Packet Format (244 bytes max)
```
[seq32|len16|crc16|payload<=236]

seq32   - Sequence number (little-endian)
len16   - Payload length (little-endian) 
crc16   - CRC16-CCITT of payload (little-endian)
payload - WAV file data (up to 236 bytes)
```

### EOF Packet
```
[seq32|0000|0000] - len=0, crc=0 indicates end of file
```

## Flow Control - Credit System

### Initial Credits
- App sends 64 credits when starting transfer
- Arduino can send packets only when it has credits
- Each packet sent consumes 1 credit

### Credit Replenishment
- App sends 2 credits for every 2 packets received
- Prevents buffer overflow while maintaining speed
- Arduino caps credits at 64 to prevent overflow

## Error Handling

### CRC Validation
- Each packet includes CRC16-CCITT checksum
- App validates CRC but continues on mismatch (logs warning)
- Packet reordering handled via sequence numbers

### Packet Reordering
- App buffers out-of-order packets
- Processes packets in sequence order
- Buffer limited to 100 packets to prevent memory issues

### Connection Recovery
- 60-second transfer timeout
- Accepts transfers that reach 99% completion
- Auto-disconnect after transfer or timeout

## Implementation Details

### Arduino (ble.cpp)
- **Advertising Name**: "XIAO-REC"
- **Buffer**: 2KB I/O buffer for SD card reads
- **Performance**: ~1KB/s transfer rate typical
- **Memory**: Credit capped at 64, sequence tracking

### React Native (BLEFileTransferService.ts)
- **Scanning**: No UUID filter - scans ALL devices, filters by name
- **Connection**: Auto-connects to first XIAO device found  
- **Storage**: WAV saved to `FileSystem.documentDirectory`
- **Processing**: FormData upload to `/api/transcribe` endpoint

### File Flow in App
1. **BLE Download**: `BLEFileTransferService.downloadFile()` → `Uint8Array`
2. **Local Save**: `FileSystem.writeAsStringAsync()` → `documentDirectory/filename.wav`
3. **Backend Upload**: `APIService.transcribeAudio(formData)` → transcription
4. **UI Update**: Add transcript to app state and display

## Protocol Sequence

```
1. XIAO: Start advertising "XIAO-REC" 
2. App:  Scan and find XIAO device
3. App:  Connect to XIAO
4. App:  Read FILE_INFO characteristic → get file size/name
5. App:  Send 64 credits via RX_CREDITS
6. XIAO: Start sending data packets via TX_DATA notifications
7. App:  For every 2 packets received → send 2 more credits
8. XIAO: Send EOF packet when file complete
9. App:  Process WAV file through transcription pipeline
10.Both: Disconnect
```

## Debugging

### Common Issues
- **Device Not Found**: XIAO not advertising (switch not LOW) or Bluetooth off
- **Connection Failed**: XIAO out of range or already connected elsewhere  
- **Transfer Stalled**: Credit system issue or BLE interference
- **CRC Errors**: BLE packet corruption (usually recoverable)

### Debug Logging
- Arduino: Serial monitor shows BLE state and transfer progress
- App: Console logs all BLE operations, packets, and errors

This protocol provides reliable WAV file transfer with flow control, error recovery, and automatic device discovery for seamless user experience.