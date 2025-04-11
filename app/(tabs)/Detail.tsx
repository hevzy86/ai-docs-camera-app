import { FlatList, Image, ActivityIndicator } from "react-native";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
  SafeAreaView,
  ScrollView,
  PanResponder,
  Animated,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  CameraCapturedPicture,
  BarcodeScanningResult,
} from "expo-camera";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import OpenAI from "openai";
import * as ImageManipulator from "expo-image-manipulator";
import * as Crypto from "expo-crypto";

import {
  useNavigation,
  NavigationProp,
  ParamListBase,
} from "@react-navigation/native";

type PhotoItem = {
  uri: string;
};

type Language = "en" | "es" | "ru";

type LanguageOption = {
  code: Language;
  label: string;
  flag: string;
};

const languages: LanguageOption[] = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
];

const { width, height } = Dimensions.get("window");
const itemSize = width / 3;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
});

const Detail = () => {
  const [capturedPhotos, setCapturedPhotos] = useState<PhotoItem[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>("");
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("en");
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const scrollViewRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams();
  const analyzeImmediately = params.analyzeImmediately === "true";

  // Animation value for panel height
  const panelHeight = useRef(new Animated.Value(1)).current;

  // Simple cache for image analysis results
  const analysisCache = useRef<Record<string, string>>({});

  // Configure pan responder for swipe gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        // Only respond to downward and upward swipes
        if (Math.abs(gestureState.dy) > Math.abs(gestureState.dx)) {
          if (gestureState.dy > 20 && !isAnalysisCollapsed) {
            // Swipe down - collapse
            setIsAnalysisCollapsed(true);
            Animated.timing(panelHeight, {
              toValue: 0,
              duration: 200,
              useNativeDriver: false,
            }).start();
          } else if (gestureState.dy < -20 && isAnalysisCollapsed) {
            // Swipe up - expand
            setIsAnalysisCollapsed(false);
            Animated.timing(panelHeight, {
              toValue: 1,
              duration: 200,
              useNativeDriver: false,
            }).start();
          }
        }
      },
      onPanResponderRelease: () => {
        // Optional: Add bounce-back animation if needed
      },
    })
  ).current;

  // Toggle panel with animation
  const togglePanel = () => {
    setIsAnalysisCollapsed(!isAnalysisCollapsed);
    Animated.timing(panelHeight, {
      toValue: isAnalysisCollapsed ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  // Add API key check
  useEffect(() => {
    if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
      console.error("OpenAI API key is not set!");
      setAiAnalysis(
        "Error: OpenAI API key is not configured. Please check your environment variables."
      );
    } else {
      console.log("OpenAI API key is configured");
    }
  }, []);

  // Load saved analysis results from AsyncStorage
  const loadAnalysisCache = useCallback(async () => {
    try {
      const savedAnalysis = await AsyncStorage.getItem("analysisCache");
      if (savedAnalysis) {
        const parsedCache = JSON.parse(savedAnalysis);
        // Update the in-memory cache with saved results
        analysisCache.current = { ...analysisCache.current, ...parsedCache };
        console.log("Loaded analysis cache from storage");
      }
    } catch (error) {
      console.error("Failed to load analysis cache", error);
    }
  }, []);

  // Clear the analysis cache (for debugging)
  const clearAnalysisCache = async () => {
    try {
      analysisCache.current = {};
      await AsyncStorage.removeItem("analysisCache");
      console.log("Analysis cache cleared");
    } catch (error) {
      console.error("Failed to clear analysis cache", error);
    }
  };

  // Save analysis results to AsyncStorage
  const saveAnalysisToStorage = async (
    imageUri: string,
    analysis: string,
    imageHash: string
  ) => {
    try {
      // First update the in-memory cache using the hash as the key
      analysisCache.current[imageHash] = analysis;

      // Then save to AsyncStorage
      // We get the existing cache first to avoid overwriting other entries
      const existingCache = await AsyncStorage.getItem("analysisCache");
      const cacheToSave = existingCache
        ? { ...JSON.parse(existingCache), [imageHash]: analysis }
        : { [imageHash]: analysis };

      await AsyncStorage.setItem("analysisCache", JSON.stringify(cacheToSave));
      console.log(
        "Saved analysis to persistent storage with hash:",
        imageHash.substring(0, 10) + "..."
      );

      // Also save with language information for the new translation system
      const analysisData = {
        text: analysis,
        timestamp: new Date().toISOString(),
        language: selectedLanguage,
      };

      await AsyncStorage.setItem(
        `analysis_${imageUri}_${selectedLanguage}`,
        JSON.stringify(analysisData)
      );
      console.log(
        `Saved analysis for ${imageUri.substring(
          0,
          20
        )}... in ${selectedLanguage}`
      );
    } catch (error) {
      console.error("Failed to save analysis to storage", error);
    }
  };

  // Load saved language preference
  const loadLanguagePreference = useCallback(async () => {
    try {
      const savedLanguage = await AsyncStorage.getItem("selectedLanguage");
      if (savedLanguage) {
        setSelectedLanguage(savedLanguage as Language);
        console.log("Loaded language preference:", savedLanguage);
      }
    } catch (error) {
      console.error("Failed to load language preference", error);
    }
  }, []);

  // Save language preference
  const saveLanguagePreference = async (language: Language) => {
    try {
      await AsyncStorage.setItem("selectedLanguage", language);
      console.log("Saved language preference:", language);
    } catch (error) {
      console.error("Failed to save language preference", error);
    }
  };

  // Translate existing analysis to the new language
  const translateAnalysis = async (text: string, targetLanguage: Language) => {
    try {
      setIsAnalyzing(true);
      console.log(`Translating existing analysis to ${targetLanguage}...`);

      let promptText = "";
      if (targetLanguage === "en") {
        promptText = `Translate the following text to English: "${text}"`;
      } else if (targetLanguage === "es") {
        promptText = `Translate the following text to Spanish: "${text}"`;
      } else if (targetLanguage === "ru") {
        promptText = `Translate the following text to Russian: "${text}"`;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: promptText,
              },
            ],
          },
        ],
      });

      const translatedText =
        response.choices[0].message.content || "Translation failed";
      console.log("Translation completed");
      setAiAnalysis(translatedText);

      // Create a hash for the translated text
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${selectedPhoto?.uri}_${targetLanguage}`
      );

      // Save the translation to cache
      await saveAnalysisToStorage(
        selectedPhoto?.uri || "",
        translatedText,
        imageHash
      );

      return translatedText;
    } catch (error) {
      console.error("Error translating text:", error);
      return `Error translating text: ${error}`;
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Get all cached analyses
  const getAllCachedAnalyses = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const analysisKeys = keys.filter((key) => key.startsWith("analysis_"));
      const analyses = await AsyncStorage.multiGet(analysisKeys);
      return analyses.map(([key, value]) => {
        const uri = key.replace("analysis_", "").split("_")[0]; // Extract URI from the key
        return {
          key,
          uri,
          analysis: value,
        };
      });
    } catch (error) {
      console.error("Error getting all cached analyses:", error);
      return [];
    }
  };

  // Translate all cached analyses to the new language
  const translateAllCachedAnalyses = async (targetLanguage: Language) => {
    try {
      console.log("Translating all cached analyses to", targetLanguage);

      // Get all cached analyses
      const cachedAnalyses = await getAllCachedAnalyses();

      // Filter analyses that don't already have a translation in the target language
      const analysesToTranslate = cachedAnalyses.filter((item) => {
        // Check if this is from a different language
        return !item.key.includes(`_${targetLanguage}`);
      });

      console.log(`Found ${analysesToTranslate.length} analyses to translate`);

      // Translate each analysis
      for (const item of analysesToTranslate) {
        if (item.analysis) {
          console.log(
            `Translating analysis for URI: ${item.uri.substring(0, 20)}...`
          );

          // Only translate if we have an analysis
          const analysis = JSON.parse(item.analysis);

          // Skip if this is already in the target language
          if (analysis.language === targetLanguage) {
            console.log("Analysis already in target language, skipping");
            continue;
          }

          // Create a background translation task
          translateAnalysisInBackground(
            analysis.text,
            item.uri,
            targetLanguage
          );
        }
      }
    } catch (error) {
      console.error("Error translating all cached analyses:", error);
    }
  };

  // Translate analysis in background without blocking UI
  const translateAnalysisInBackground = async (
    text: string,
    imageUri: string,
    targetLanguage: Language
  ) => {
    try {
      console.log(
        `Background translation for ${imageUri.substring(
          0,
          20
        )}... to ${targetLanguage}`
      );

      let promptText = "";
      if (targetLanguage === "en") {
        promptText = `Translate the following text to English: "${text}"`;
      } else if (targetLanguage === "es") {
        promptText = `Translate the following text to Spanish: "${text}"`;
      } else if (targetLanguage === "ru") {
        promptText = `Translate the following text to Russian: "${text}"`;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: promptText,
              },
            ],
          },
        ],
      });

      const translatedText =
        response.choices[0].message.content || "Translation failed";
      console.log(
        `Background translation completed for ${imageUri.substring(0, 20)}...`
      );

      // Create a hash for the translated text
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${imageUri}_${targetLanguage}`
      );

      // Save the translation to cache
      await saveAnalysisToStorage(imageUri, translatedText, imageHash);
    } catch (error) {
      console.error("Error in background translation:", error);
    }
  };

  // Load saved photos
  const loadSavedPhotos = useCallback(async () => {
    try {
      const savedPhotos = await AsyncStorage.getItem("capturedPhotos");
      if (savedPhotos) {
        setCapturedPhotos(JSON.parse(savedPhotos));
      }

      // Load the analysis cache when loading photos
      await loadAnalysisCache();
      await loadLanguagePreference();
    } catch (error) {
      console.error("Failed to load photos", error);
    }
  }, [loadAnalysisCache, loadLanguagePreference]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadSavedPhotos();
    });

    return () => unsubscribe();
  }, [navigation, loadSavedPhotos]);

  // Effect to handle automatic analysis when navigated with analyzeImmediately=true
  useEffect(() => {
    const handleImmediateAnalysis = async () => {
      if (analyzeImmediately && capturedPhotos.length > 0) {
        // Get the most recent photo (first in the array)
        const mostRecentPhoto = capturedPhotos[0];

        // Open the photo
        await openPhoto(mostRecentPhoto);

        // Start analyzing after a short delay to ensure the UI is updated
        setTimeout(() => {
          if (mostRecentPhoto) {
            analyzeImage(mostRecentPhoto.uri);
          }
        }, 500);
      }
    };

    handleImmediateAnalysis();
  }, [analyzeImmediately, capturedPhotos]);

  // Effect to ensure panel is expanded when a photo with analysis is shown
  useEffect(() => {
    // If we have analysis, make sure the panel is expanded
    if (aiAnalysis) {
      console.log("Analysis detected, ensuring panel is expanded");
      setIsAnalysisCollapsed(false);
      // Reset animation value to expanded state
      panelHeight.setValue(1);
    }
  }, [selectedPhoto, aiAnalysis]);

  // Set header right component with select button
  useEffect(() => {
    if (capturedPhotos.length > 0) {
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity
            style={styles.headerSelectButton}
            onPress={toggleSelectionMode}
          >
            <Text style={styles.headerButtonText}>
              {isSelectionMode ? "Cancel" : "Select"}
            </Text>
          </TouchableOpacity>
        ),
      });
    }
  }, [navigation, capturedPhotos.length, isSelectionMode]);

  // Set header right component with delete button when in selection mode
  useEffect(() => {
    if (isSelectionMode && selectedPhotos.size > 0) {
      navigation.setOptions({
        headerRight: () => (
          <View style={styles.headerButtonsContainer}>
            <TouchableOpacity
              style={styles.headerDeleteButton}
              onPress={() => setShowDeleteConfirmation(true)}
            >
              <Text style={styles.headerButtonText}>
                Delete ({selectedPhotos.size})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerSelectButton}
              onPress={toggleSelectionMode}
            >
              <Text style={styles.headerButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [navigation, isSelectionMode, selectedPhotos.size]);

  const openPhoto = async (item: PhotoItem) => {
    // Clear any previous analysis when opening a new photo
    setAiAnalysis(null);
    setSelectedPhoto(item);

    // Don't clear cache when opening a photo so we can reuse previous analyses
    // clearAnalysisCache();

    // Try to load cached analysis immediately when opening a photo
    try {
      // Create a hash for this image
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${item.uri}_${selectedLanguage}` // Include language in the hash
      );

      // Check in-memory cache first
      if (analysisCache.current[imageHash]) {
        console.log("Found analysis in memory cache when opening photo");
        setAiAnalysis(analysisCache.current[imageHash]);
        return;
      }

      // If not in memory, check AsyncStorage
      const savedAnalysis = await AsyncStorage.getItem("analysisCache");
      if (savedAnalysis) {
        const parsedCache = JSON.parse(savedAnalysis);
        if (parsedCache[imageHash]) {
          console.log(
            "Found analysis in persistent storage when opening photo"
          );
          // Update in-memory cache and set analysis
          analysisCache.current[imageHash] = parsedCache[imageHash];
          setAiAnalysis(parsedCache[imageHash]);
          return;
        }
      }

      // If we get here, there's no cached analysis for this photo
      console.log("No cached analysis found for this photo");
    } catch (error) {
      console.error("Error checking cache when opening photo:", error);
    }
  };

  const closePhoto = () => {
    setSelectedPhoto(null);
    setAiAnalysis(null);
  };

  const analyzeImage = async (imageUri: string) => {
    try {
      // Reset states
      setIsAnalyzing(true);
      setAiAnalysis(null);

      // Don't clear the cache to allow reusing previous analyses
      // await clearAnalysisCache();

      console.log(
        "Analyzing image with URI:",
        imageUri.substring(0, 30) + "..."
      );

      // Create a unique hash for this image based on the original URI and language
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${imageUri}_${selectedLanguage}` // Include language in the hash
      );

      console.log("Generated image hash:", imageHash.substring(0, 10) + "...");
      console.log("Checking cache for existing analysis...");

      // Check in-memory cache first using the hash
      if (analysisCache.current[imageHash]) {
        setAnalysisStep("Loading from cache...");
        console.log("Found analysis in memory cache");
        setTimeout(() => {
          setAiAnalysis(analysisCache.current[imageHash]);
          setIsAnalyzing(false);
        }, 500); // Small delay to show loading from cache
        return analysisCache.current[imageHash];
      }

      // If not in memory, check AsyncStorage
      setAnalysisStep("Checking storage...");
      try {
        const savedAnalysis = await AsyncStorage.getItem("analysisCache");
        if (savedAnalysis) {
          const parsedCache = JSON.parse(savedAnalysis);
          if (parsedCache[imageHash]) {
            // Found in AsyncStorage, update in-memory cache and return
            console.log("Found analysis in persistent storage");
            analysisCache.current[imageHash] = parsedCache[imageHash];
            setAiAnalysis(parsedCache[imageHash]);
            setIsAnalyzing(false);
            return parsedCache[imageHash];
          }
        }
      } catch (error) {
        console.error("Error checking AsyncStorage:", error);
        // Continue with API call if storage check fails
      }

      console.log("No cached analysis found, calling OpenAI API...");

      // Resize and compress the image first
      setAnalysisStep("Optimizing image...");
      const optimizedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800 } }], // Resize to 800px width
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
        throw new Error("OpenAI API key is not configured");
      }

      // First, fetch the optimized image
      setAnalysisStep("Processing image...");
      const response = await fetch(optimizedImage.uri);
      const blob = await response.blob();

      // Convert blob to base64
      const reader = new FileReader();
      return new Promise<string>((resolve, reject) => {
        reader.onload = async () => {
          try {
            const base64data = reader.result as string;
            // Remove the data URL prefix
            const base64Image = base64data.split(",")[1];

            setAnalysisStep("Sending to AI for analysis...");
            console.log("Sending request to OpenAI..."); // Debug log

            let promptText =
              "Describe this image in general terms. If there are people, describe the scene generally without identifying individuals.";

            // Add language instruction based on selected language
            console.log("Setting prompt for language:", selectedLanguage);

            if (selectedLanguage === "es") {
              console.log("Using Spanish prompt");
              promptText =
                "Describe esta imagen en términos generales. Si hay personas, describe la escena en general sin identificar a las personas. Responde completamente en español.";
            } else if (selectedLanguage === "ru") {
              console.log("Using Russian prompt");
              promptText =
                "Опишите это изображение в общих чертах. Если на нем есть люди, опишите сцену в целом, не идентифицируя людей. Ответьте полностью на русском языке.";
            } else {
              console.log("Using English prompt");
            }

            console.log(`Using prompt for language: ${selectedLanguage}`);
            console.log(`Prompt text: ${promptText.substring(0, 30)}...`);

            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: promptText,
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/jpeg;base64,${base64Image}`,
                      },
                    },
                  ],
                },
              ],
            });

            console.log("Received response from OpenAI"); // Debug log
            setAnalysisStep("Analysis complete!");

            const analysisResult =
              response.choices[0].message.content || "No analysis available";

            // Re-enable caching to save analyses for future use
            await saveAnalysisToStorage(imageUri, analysisResult, imageHash);

            setAiAnalysis(analysisResult);

            // Ensure the panel is expanded when analysis completes
            setIsAnalysisCollapsed(false);
            // Animate the panel to expanded state
            Animated.timing(panelHeight, {
              toValue: 1,
              duration: 200,
              useNativeDriver: false,
            }).start();

            resolve(analysisResult);
          } catch (error: any) {
            console.error("Error in OpenAI API call:", error);
            console.error("Error details:", {
              message: error.message,
              type: error.type,
              code: error.code,
              status: error.status,
            });
            setAiAnalysis(`Error analyzing image: ${error.message}`);
            reject(error);
          } finally {
            setIsAnalyzing(false);
          }
        };
        reader.onerror = (error) => {
          console.error("Error reading blob:", error);
          setAiAnalysis("Error processing image. Please try again.");
          setIsAnalyzing(false);
          reject(error);
        };
        reader.readAsDataURL(blob);
      });
    } catch (error: any) {
      console.error("Error in analyzeImage:", error);
      setAiAnalysis(`Error: ${error.message}`);
      setIsAnalyzing(false);
    }
  };

  // Toggle selection mode
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    if (isSelectionMode) {
      // Clear selections when exiting selection mode
      setSelectedPhotos(new Set());
    }
  };

  // Toggle photo selection
  const togglePhotoSelection = (uri: string) => {
    const newSelectedPhotos = new Set(selectedPhotos);
    if (newSelectedPhotos.has(uri)) {
      newSelectedPhotos.delete(uri);
    } else {
      newSelectedPhotos.add(uri);
    }
    setSelectedPhotos(newSelectedPhotos);
  };

  // Delete selected photos
  const deleteSelectedPhotos = async () => {
    try {
      // Filter out the selected photos
      const remainingPhotos = capturedPhotos.filter(
        (photo) => !selectedPhotos.has(photo.uri)
      );

      // Update state
      setCapturedPhotos(remainingPhotos);

      // Save to storage
      await AsyncStorage.setItem(
        "capturedPhotos",
        JSON.stringify(remainingPhotos)
      );

      // Clear selections and exit selection mode
      setSelectedPhotos(new Set());
      setIsSelectionMode(false);
      setShowDeleteConfirmation(false);

      // Also delete analysis cache for these photos
      for (const uri of selectedPhotos) {
        // Get all keys from AsyncStorage
        const keys = await AsyncStorage.getAllKeys();

        // Find and delete all analysis entries for this photo
        const keysToRemove = keys.filter(
          (key) =>
            key.startsWith(`analysis_${uri}`) ||
            (key === "analysisCache" && analysisCache.current)
        );

        if (keysToRemove.includes("analysisCache") && analysisCache.current) {
          // For the global cache, we need to remove just the entries for these photos
          const existingCache = await AsyncStorage.getItem("analysisCache");
          if (existingCache) {
            const parsedCache = JSON.parse(existingCache);

            // Find and remove all entries for this photo
            Object.keys(parsedCache).forEach((key) => {
              if (key.includes(uri)) {
                delete parsedCache[key];
              }
            });

            // Save the updated cache
            await AsyncStorage.setItem(
              "analysisCache",
              JSON.stringify(parsedCache)
            );

            // Update in-memory cache
            Object.keys(analysisCache.current).forEach((key) => {
              if (key.includes(uri)) {
                delete analysisCache.current[key];
              }
            });
          }
        } else if (keysToRemove.length > 0) {
          // Remove individual analysis entries
          await AsyncStorage.multiRemove(keysToRemove);
        }
      }

      console.log(`Deleted ${selectedPhotos.size} photos and their analyses`);
    } catch (error) {
      console.error("Error deleting photos:", error);
    }
  };

  const renderItem = ({ item }: { item: PhotoItem }) => {
    const isSelected = selectedPhotos.has(item.uri);

    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.selectedItem]}
        onPress={() => {
          if (isSelectionMode) {
            togglePhotoSelection(item.uri);
          } else {
            openPhoto(item);
          }
        }}
        onLongPress={() => {
          if (!isSelectionMode) {
            setIsSelectionMode(true);
            togglePhotoSelection(item.uri);
          }
        }}
      >
        <Image
          source={{ uri: item.uri }}
          style={styles.photo}
        />
        {isSelectionMode && (
          <View style={styles.selectionOverlay}>
            {isSelected && (
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Render delete confirmation modal
  const renderDeleteConfirmation = () => {
    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={showDeleteConfirmation}
        onRequestClose={() => setShowDeleteConfirmation(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmationDialog}>
            <Text style={styles.confirmationTitle}>Delete Photos</Text>
            <Text style={styles.confirmationText}>
              Are you sure you want to delete {selectedPhotos.size} selected
              photo{selectedPhotos.size !== 1 ? "s" : ""}? This action cannot be
              undone.
            </Text>
            <View style={styles.confirmationButtons}>
              <TouchableOpacity
                style={[styles.confirmationButton, styles.cancelButton]}
                onPress={() => setShowDeleteConfirmation(false)}
              >
                <Text style={styles.confirmationButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmationButton, styles.deleteButton]}
                onPress={deleteSelectedPhotos}
              >
                <Text style={styles.confirmationButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

const renderFullScreenPhoto = () => (
  <Modal
    visible={selectedPhoto !== null}
    transparent={false}
    animationType="fade"
  >
    <SafeAreaView style={styles.fullScreenContainer}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={closePhoto}
        >
          <Text style={styles.closeButtonText}>←</Text>
        </TouchableOpacity>

        {renderLanguageSwitcher()}

        <TouchableOpacity
          style={styles.analyzeButton}
          onPress={() => selectedPhoto && analyzeImage(selectedPhoto.uri)}
          disabled={isAnalyzing}
        >
          <Text style={styles.analyzeButtonText}>
            {isAnalyzing ? (
              <ActivityIndicator
                size="small"
                color="#fff"
              />
            ) : (
              "Analyze Image"
            )}
          </Text>
        </TouchableOpacity>
      </View>

      <Image
        source={{ uri: selectedPhoto?.uri }}
        style={styles.fullScreenPhoto}
        resizeMode="contain"
      />

      {isAnalyzing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />
          <Text style={styles.loadingText}>
            {analysisStep || "Analyzing image..."}
          </Text>
        </View>
      )}

      {aiAnalysis && (
        <Animated.View
          style={[
            styles.analysisContainer,
            {
              maxHeight: panelHeight.interpolate({
                inputRange: [0, 1],
                outputRange: ["8%", "60%"],
              }),
            },
          ]}
        >
          <TouchableOpacity
            style={styles.handleContainer}
            onPress={togglePanel}
            activeOpacity={0.7}
            {...panResponder.panHandlers}
          >
            <View style={styles.handle} />
          </TouchableOpacity>

          {!isAnalysisCollapsed && (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollViewContent}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              <Text style={styles.analysisText}>{aiAnalysis}</Text>
            </ScrollView>
          )}
        </Animated.View>
      )}
    </SafeAreaView>
  </Modal>
);






  // Load analysis from storage
  const loadAnalysisFromStorage = async (imageUri: string) => {
    try {
      // Try to load analysis for the current language
      const key = `analysis_${imageUri}_${selectedLanguage}`;
      const savedAnalysis = await AsyncStorage.getItem(key);

      if (savedAnalysis) {
        const parsedAnalysis = JSON.parse(savedAnalysis);
        console.log(
          `Loaded cached analysis for ${imageUri.substring(
            0,
            20
          )}... in ${selectedLanguage}`
        );
        return parsedAnalysis.text;
      }

      // If no analysis for current language, check if we have it in any language
      const keys = await AsyncStorage.getAllKeys();
      const matchingKeys = keys.filter((k) =>
        k.startsWith(`analysis_${imageUri}_`)
      );

      if (matchingKeys.length > 0) {
        // We have analysis in another language, translate it immediately
        const otherLangAnalysis = await AsyncStorage.getItem(matchingKeys[0]);
        if (otherLangAnalysis) {
          const parsedAnalysis = JSON.parse(otherLangAnalysis);
          console.log(
            `Found analysis in different language, translating from ${parsedAnalysis.language} to ${selectedLanguage}`
          );

          setIsAnalyzing(true);

          let promptText = "";
          if (selectedLanguage === "en") {
            promptText = `Translate the following text to English: "${parsedAnalysis.text}"`;
          } else if (selectedLanguage === "es") {
            promptText = `Translate the following text to Spanish: "${parsedAnalysis.text}"`;
          } else if (selectedLanguage === "ru") {
            promptText = `Translate the following text to Russian: "${parsedAnalysis.text}"`;
          }

          try {
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: promptText,
                    },
                  ],
                },
              ],
            });

            const translatedText =
              response.choices[0].message.content || "Translation failed";

            // Create a hash for the translated text
            const imageHash = await Crypto.digestStringAsync(
              Crypto.CryptoDigestAlgorithm.SHA256,
              `${imageUri}_${selectedLanguage}`
            );

            // Save the translation to cache
            await saveAnalysisToStorage(imageUri, translatedText, imageHash);

            setIsAnalyzing(false);
            return translatedText;
          } catch (error) {
            console.error("Error translating text:", error);
            setIsAnalyzing(false);
            return `Error translating: ${error}`;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Error loading analysis from storage:", error);
      return null;
    }
  };

  // Change language
  const changeLanguage = async (language: Language) => {
    if (language === selectedLanguage) {
      // If the same language is selected, just close the menu
      setIsLanguageMenuOpen(false);
      return;
    }

    console.log(`Changing language from ${selectedLanguage} to ${language}`);
    const previousLanguage = selectedLanguage;
    setSelectedLanguage(language);
    setIsLanguageMenuOpen(false);
    await saveLanguagePreference(language);

    // If there's an analysis, translate it instead of reanalyzing
    if (selectedPhoto && aiAnalysis) {
      console.log(
        `Language changed to ${language}, translating existing analysis...`
      );

      // Translate the existing analysis instead of reanalyzing the image
      await translateAnalysis(aiAnalysis, language);
    }

    // Start background translation of all cached analyses
    translateAllCachedAnalyses(language);
  };

  const renderLanguageSwitcher = () => (
    <View style={styles.languageSwitcherContainer}>
      <TouchableOpacity
        style={styles.languageButton}
        onPress={() => setIsLanguageMenuOpen(!isLanguageMenuOpen)}
      >
        <Text style={styles.languageButtonText}>
          {languages.find((lang) => lang.code === selectedLanguage)?.flag}{" "}
          {selectedLanguage.toUpperCase()}
        </Text>
      </TouchableOpacity>

      {isLanguageMenuOpen && (
        <View style={styles.languageMenu}>
          {languages.map((language) => (
            <TouchableOpacity
              key={language.code}
              style={[
                styles.languageOption,
                selectedLanguage === language.code &&
                  styles.selectedLanguageOption,
              ]}
              onPress={() => changeLanguage(language.code)}
            >
              <Text style={styles.languageOptionText}>
                {language.flag} {language.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {capturedPhotos.length > 0 ? (
        <FlatList
          data={capturedPhotos}
          renderItem={renderItem}
          keyExtractor={(item, index) => index.toString()}
          numColumns={3}
        />
      ) : (
        <Text style={styles.noPhotosText}>No photos captured yet.</Text>
      )}
      {renderFullScreenPhoto()}
      {renderDeleteConfirmation()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  item: {
    width: itemSize,
    height: itemSize,
    padding: 2,
    position: "relative",
  },

  photo: {
    width: "100%",
    height: "100%",
  },

  selectedItem: {
    opacity: 0.7,
  },

  selectionOverlay: {
    position: "absolute",
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderWidth: 2,
    borderColor: "#007AFF",
  },

  checkmark: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
  },

  checkmarkText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },

  headerButtonsContainer: {
    flexDirection: "row",
    alignItems: "center",
  },

  headerSelectButton: {
    backgroundColor: "rgba(0, 122, 255, 0.8)",
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 15,
    marginLeft: 0,
    marginRight: 16,
  },

  headerDeleteButton: {
    backgroundColor: "rgba(255, 59, 48, 0.8)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 4,
  },

  headerButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  confirmationDialog: {
    width: "80%",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },

  confirmationTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
  },

  confirmationText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },

  confirmationButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },

  confirmationButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
    width: "45%",
    alignItems: "center",
  },

  cancelButton: {
    backgroundColor: "#E0E0E0",
  },

  deleteButton: {
    backgroundColor: "#FF3B30",
  },

  confirmationButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },

  fullScreenContainer: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
  },

  fullScreenPhoto: {
    width: "100%",
    height: "100%",
  },

  closeButton: {
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 8,
    minWidth: 50,
    alignItems: "center",
  },

  closeButtonText: {
    color: "white",
    fontSize: 24,
    fontWeight: "600",
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    position: "absolute",
    top: 40,
    left: 20,
    right: 20,
    zIndex: 1,
  },

  analyzeButton: {
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 8,
    minWidth: 120,
    alignItems: "center",
  },

  analyzeButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },

  loadingContainer: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 20,
    borderRadius: 10,
  },

  loadingText: {
    color: "white",
    marginTop: 10,
    fontSize: 16,
  },

  analysisContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(28,28,30,0.92)",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  handleContainer: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 12,
  },

  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
  },

  scrollView: {
    flexGrow: 0,
    marginBottom: 10,
  },

  scrollViewContent: {
    paddingBottom: 20,
  },

  analysisText: {
    color: "white",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },

  languageSwitcherContainer: {
    position: "relative",
    zIndex: 10,
  },
  languageButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 5,
  },
  languageButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  languageMenu: {
    position: "absolute",
    top: 40,
    left: 0,
    backgroundColor: "#fff",
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    padding: 5,
    width: 150,
    zIndex: 20,
  },
  languageOption: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
  },
  selectedLanguageOption: {
    backgroundColor: "#f0f0f0",
  },
  languageOptionText: {
    fontSize: 14,
  },
  noPhotosText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 20,
    color: "#666",
  },
  photoTouchOverlay: {
    position: "absolute",
    top: 100, // Leave space for the header buttons
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: 1,
  },
});

export default Detail;
