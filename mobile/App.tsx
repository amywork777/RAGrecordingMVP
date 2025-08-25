import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, Platform } from 'react-native';

import RecordScreen from './src/screens/RecordScreen';
import ChatScreen from './src/screens/ChatScreen';
import { colors } from './src/theme/colors';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: keyof typeof Ionicons.glyphMap;

            if (route.name === 'Record') {
              iconName = focused ? 'mic-circle' : 'mic-circle-outline';
            } else if (route.name === 'Chat') {
              iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
            } else {
              iconName = 'alert-circle';
            }

            return (
              <View style={{
                padding: 4,
                borderRadius: 12,
                backgroundColor: focused ? `${colors.primary.main}15` : 'transparent',
              }}>
                <Ionicons name={iconName} size={28} color={color} />
              </View>
            );
          },
          tabBarActiveTintColor: colors.primary.main,
          tabBarInactiveTintColor: colors.text.secondary,
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.background.elevated,
            borderTopWidth: 0,
            elevation: 0,
            shadowOffset: { width: 0, height: -4 },
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            height: Platform.OS === 'ios' ? 85 : 65,
            paddingBottom: Platform.OS === 'ios' ? 25 : 10,
            paddingTop: 10,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            marginTop: 4,
          },
        })}
      >
        <Tab.Screen 
          name="Record" 
          component={RecordScreen}
          options={{
            tabBarLabel: 'Record',
          }}
        />
        <Tab.Screen 
          name="Chat" 
          component={ChatScreen}
          options={{
            tabBarLabel: 'Chat',
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
