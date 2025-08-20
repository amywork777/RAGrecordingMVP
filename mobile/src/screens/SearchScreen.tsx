import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import APIService from '../services/APIService';
import { colors, spacing, borderRadius, typography } from '../theme/colors';

interface SearchResult {
  id: string;
  text: string;
  title?: string;
  summary?: string;
  aiTitle?: string;
  aiSummary?: string;
  timestamp: string;
  score: number;
  matches?: number;
  snippet?: string;
  path?: string;
}

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string>('');
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Search', 'Please enter a search query');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setAiAnswer('');

    try {
      const response = await APIService.searchTranscripts(searchQuery, searchMode);
      
      if (response.results) {
        setSearchResults(response.results);
      }
      
      if (response.answer && searchMode === 'semantic') {
        setAiAnswer(response.answer);
      }
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Search Error', 'Failed to search transcripts');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedResults(newExpanded);
  };

  const highlightText = (text: string, query: string) => {
    if (!query || searchMode !== 'keyword') return text;
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) => 
      part.toLowerCase() === query.toLowerCase() ? 
        `**${part}**` : part
    ).join('');
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.background.primary, colors.background.secondary]}
        style={styles.gradient}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Search Transcripts</Text>
            
            {/* Search Mode Toggle */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  searchMode === 'keyword' && styles.modeButtonActive
                ]}
                onPress={() => setSearchMode('keyword')}
              >
                <Ionicons 
                  name="search" 
                  size={16} 
                  color={searchMode === 'keyword' ? '#fff' : colors.text.secondary} 
                />
                <Text style={[
                  styles.modeText,
                  searchMode === 'keyword' && styles.modeTextActive
                ]}>
                  Keyword
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  searchMode === 'semantic' && styles.modeButtonActive
                ]}
                onPress={() => setSearchMode('semantic')}
              >
                <Ionicons 
                  name="chatbubbles" 
                  size={16} 
                  color={searchMode === 'semantic' ? '#fff' : colors.text.secondary} 
                />
                <Text style={[
                  styles.modeText,
                  searchMode === 'semantic' && styles.modeTextActive
                ]}>
                  AI Chat
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Input */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={20} color={colors.text.secondary} />
              <TextInput
                style={styles.searchInput}
                placeholder={searchMode === 'keyword' ? 
                  "Search for keywords..." : 
                  "Ask a question about your recordings..."
                }
                placeholderTextColor={colors.text.disabled}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color={colors.text.secondary} />
                </TouchableOpacity>
              )}
            </View>
            
            <TouchableOpacity
              style={styles.searchButton}
              onPress={handleSearch}
              disabled={isSearching}
            >
              <LinearGradient
                colors={[colors.primary.main, colors.secondary.main]}
                style={styles.searchButtonGradient}
              >
                {isSearching ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.searchButtonText}>Search</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Search Mode Description */}
          <Text style={styles.modeDescription}>
            {searchMode === 'keyword' ? 
              'Find exact matches in your transcripts' : 
              'Get AI-powered answers from your recordings'
            }
          </Text>

          {/* Results */}
          <ScrollView 
            style={styles.resultsContainer}
            showsVerticalScrollIndicator={false}
          >
            {isSearching && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary.main} />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            )}

            {/* AI Answer (for semantic search) */}
            {aiAnswer && searchMode === 'semantic' && (
              <View style={styles.aiAnswerContainer}>
                <View style={styles.aiAnswerHeader}>
                  <Ionicons name="sparkles" size={20} color={colors.primary.main} />
                  <Text style={styles.aiAnswerTitle}>AI Answer</Text>
                </View>
                <Text style={styles.aiAnswerText}>{aiAnswer}</Text>
              </View>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <View style={styles.resultsSection}>
                <Text style={styles.resultsHeader}>
                  {searchMode === 'keyword' ? 
                    `Found ${searchResults.length} matches` : 
                    'Related Recordings'
                  }
                </Text>
                
                {searchResults.map((result) => (
                  <TouchableOpacity
                    key={result.id}
                    style={styles.resultCard}
                    onPress={() => toggleExpanded(result.id)}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={[`${colors.primary.main}10`, `${colors.secondary.main}05`]}
                      style={styles.resultGradient}
                    >
                      <View style={styles.resultHeader}>
                        <View style={styles.resultHeaderLeft}>
                          <Ionicons 
                            name={expandedResults.has(result.id) ? "chevron-down" : "chevron-forward"} 
                            size={16} 
                            color={colors.primary.main} 
                          />
                          <View style={styles.resultInfo}>
                            <Text style={styles.resultTitle}>
                              {result.aiTitle || result.title || 'Untitled'}
                            </Text>
                            <Text style={styles.resultTime}>
                              {formatTimestamp(result.timestamp)}
                            </Text>
                          </View>
                        </View>
                        {searchMode === 'keyword' && result.matches !== undefined && (
                          <View style={styles.matchBadge}>
                            <Text style={styles.matchText}>{result.matches} matches</Text>
                          </View>
                        )}
                      </View>

                      {/* Summary or Snippet */}
                      {!expandedResults.has(result.id) && (
                        <Text style={styles.resultSummary} numberOfLines={3}>
                          {searchMode === 'keyword' && result.snippet ? 
                            result.snippet : 
                            (result.aiSummary || result.summary || result.text.substring(0, 150) + '...')
                          }
                        </Text>
                      )}

                      {/* Expanded Full Text */}
                      {expandedResults.has(result.id) && (
                        <View style={styles.expandedContent}>
                          {result.aiSummary && (
                            <>
                              <Text style={styles.expandedLabel}>Summary:</Text>
                              <Text style={styles.expandedText}>{result.aiSummary}</Text>
                            </>
                          )}
                          <Text style={styles.expandedLabel}>Full Transcript:</Text>
                          <Text style={styles.expandedText}>
                            {highlightText(result.text, searchQuery)}
                          </Text>
                        </View>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* No Results */}
            {!isSearching && searchResults.length === 0 && searchQuery && (
              <View style={styles.noResults}>
                <Ionicons name="search-outline" size={40} color={colors.text.disabled} />
                <Text style={styles.noResultsText}>No results found</Text>
                <Text style={styles.noResultsSubtext}>
                  Try different keywords or switch search modes
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  gradient: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  modeButtonActive: {
    backgroundColor: colors.primary.main,
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  modeTextActive: {
    color: '#fff',
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text.primary,
    paddingVertical: spacing.md,
  },
  searchButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  searchButtonGradient: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  modeDescription: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  resultsContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.text.secondary,
    fontSize: 16,
  },
  aiAnswerContainer: {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  aiAnswerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  aiAnswerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary.main,
  },
  aiAnswerText: {
    ...typography.body,
    color: colors.text.primary,
    lineHeight: 24,
  },
  resultsSection: {
    marginBottom: spacing.xl,
  },
  resultsHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  resultCard: {
    marginBottom: spacing.md,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  resultGradient: {
    padding: spacing.md,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  resultHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },
  resultTime: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  matchBadge: {
    backgroundColor: colors.primary.main + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  matchText: {
    fontSize: 12,
    color: colors.primary.main,
    fontWeight: '600',
  },
  resultSummary: {
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  expandedContent: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.background.secondary,
  },
  expandedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  expandedText: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 3,
  },
  noResultsText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.secondary,
    marginTop: spacing.md,
  },
  noResultsSubtext: {
    ...typography.body,
    color: colors.text.disabled,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});