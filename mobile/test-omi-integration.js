/**
 * Test script for Omi Integration
 * Run with: node test-omi-integration.js
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing Omi Integration Setup...\n');

// Test 1: Check if Omi SDK is installed
console.log('1. Checking Omi SDK installation...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (packageJson.dependencies['@omiai/omi-react-native']) {
    console.log('✅ @omiai/omi-react-native SDK installed');
  } else {
    console.log('❌ Omi SDK not found in dependencies');
  }
} catch (error) {
  console.log('❌ Could not read package.json');
}

// Test 2: Check if BLE dependencies exist
console.log('\n2. Checking BLE dependencies...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (packageJson.dependencies['react-native-ble-plx']) {
    console.log('✅ react-native-ble-plx installed');
  } else {
    console.log('❌ react-native-ble-plx not found');
  }
} catch (error) {
  console.log('❌ Could not check BLE dependencies');
}

// Test 3: Check if Omi services exist
console.log('\n3. Checking Omi services...');
const omiServiceFiles = [
  'src/services/OmiBluetoothService.ts',
  'src/services/OmiAudioStreamService.ts'
];

omiServiceFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file} exists`);
  } else {
    console.log(`❌ ${file} missing`);
  }
});

// Test 4: Check if Omi components exist
console.log('\n4. Checking Omi UI components...');
const omiComponentFiles = [
  'src/components/OmiDevicePairing.tsx',
  'src/components/OmiStreamingStatus.tsx'
];

omiComponentFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file} exists`);
  } else {
    console.log(`❌ ${file} missing`);
  }
});

// Test 5: Check if RecordScreen has Omi imports
console.log('\n5. Checking RecordScreen integration...');
try {
  const recordScreen = fs.readFileSync('src/screens/RecordScreen.tsx', 'utf8');
  
  const checks = [
    { pattern: 'OmiBluetoothService', name: 'OmiBluetoothService import' },
    { pattern: 'OmiAudioStreamService', name: 'OmiAudioStreamService import' },
    { pattern: 'OmiDevicePairing', name: 'OmiDevicePairing component' },
    { pattern: 'OmiStreamingStatus', name: 'OmiStreamingStatus component' },
    { pattern: 'omiDeviceConnected', name: 'Omi state variables' },
    { pattern: 'handleOmiDeviceConnected', name: 'Omi event handlers' }
  ];
  
  checks.forEach(check => {
    if (recordScreen.includes(check.pattern)) {
      console.log(`✅ ${check.name} integrated`);
    } else {
      console.log(`❌ ${check.name} missing`);
    }
  });
} catch (error) {
  console.log('❌ Could not read RecordScreen.tsx');
}

// Test 6: Check app.json configuration
console.log('\n6. Checking app.json configuration...');
try {
  const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  const ios = appJson.expo.ios;
  const android = appJson.expo.android;
  
  // Check iOS permissions
  if (ios && ios.infoPlist) {
    const infoPlist = ios.infoPlist;
    if (infoPlist.NSBluetoothAlwaysUsageDescription) {
      console.log('✅ iOS Bluetooth permission configured');
    } else {
      console.log('❌ iOS Bluetooth permission missing');
    }
    
    if (infoPlist.NSMicrophoneUsageDescription) {
      console.log('✅ iOS Microphone permission configured');
    } else {
      console.log('❌ iOS Microphone permission missing');
    }
    
    if (infoPlist.UIBackgroundModes && infoPlist.UIBackgroundModes.includes('bluetooth-central')) {
      console.log('✅ iOS Background Bluetooth mode configured');
    } else {
      console.log('❌ iOS Background Bluetooth mode missing');
    }
  }
  
  // Check Android permissions
  if (android && android.permissions) {
    const permissions = android.permissions;
    if (permissions.includes('android.permission.BLUETOOTH_CONNECT')) {
      console.log('✅ Android Bluetooth permissions configured');
    } else {
      console.log('❌ Android Bluetooth permissions missing');
    }
  }
  
  // Check BLE plugin configuration
  if (appJson.expo.plugins && appJson.expo.plugins.some(plugin => 
    Array.isArray(plugin) && plugin[0] === 'react-native-ble-plx'
  )) {
    console.log('✅ BLE plugin configured');
  } else {
    console.log('❌ BLE plugin configuration missing');
  }
  
} catch (error) {
  console.log('❌ Could not read app.json');
}

// Test 7: Check for README documentation
console.log('\n7. Checking documentation...');
if (fs.existsSync('README.md')) {
  console.log('✅ README.md exists');
} else {
  console.log('❌ README.md missing');
}

if (fs.existsSync('../SETUP_OMI.md')) {
  console.log('✅ SETUP_OMI.md exists');
} else {
  console.log('❌ SETUP_OMI.md missing');
}

// Summary
console.log('\n📋 Integration Test Summary');
console.log('==========================');
console.log('If all tests show ✅, your Omi integration is ready!');
console.log('');
console.log('Next steps:');
console.log('1. Build dev client: npx expo run:ios (or android)');
console.log('2. Test on physical device with Omi hardware');
console.log('3. Verify Bluetooth permissions when prompted');
console.log('4. Check console logs for debugging if needed');
console.log('');
console.log('Happy coding! 🚀');