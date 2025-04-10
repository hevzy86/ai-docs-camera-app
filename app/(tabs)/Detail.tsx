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
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const scrollViewRef = useRef<ScrollView>(null);

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
    } catch (error) {
      console.error("Failed to save analysis to storage", error);
    }
  };

  const loadSavedPhotos = useCallback(async () => {
    try {
      const savedPhotos = await AsyncStorage.getItem("capturedPhotos");
      if (savedPhotos) {
        setCapturedPhotos(JSON.parse(savedPhotos));
      }

      // Load the analysis cache when loading photos
      await loadAnalysisCache();
    } catch (error) {
      console.error("Failed to load photos", error);
    }
  }, [loadAnalysisCache]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadSavedPhotos();
    });

    return () => unsubscribe();
  }, [navigation, loadSavedPhotos]);

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
        item.uri
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

      // Create a unique hash for this image based on the original URI
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        imageUri // Use the original URI, not the optimized one
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

            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "What do you see in this image? Please describe it in detail.",
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
              max_tokens: 500,
            });

            console.log("Received response from OpenAI"); // Debug log
            setAnalysisStep("Analysis complete!");

            const analysisResult =
              response.choices[0].message.content || "No analysis available";

            // Re-enable caching to save analyses for future use
            await saveAnalysisToStorage(imageUri, analysisResult, imageHash);

            setAiAnalysis(analysisResult);
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

  const renderItem = ({ item }: { item: PhotoItem }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => openPhoto(item)}
    >
      <Image
        source={{ uri: item.uri }}
        style={styles.photo}
      />
    </TouchableOpacity>
  );

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
          <TouchableOpacity
            style={styles.analyzeButton}
            onPress={() => selectedPhoto && analyzeImage(selectedPhoto.uri)}
            disabled={isAnalyzing}
          >
            <Text style={styles.analyzeButtonText}>
              {isAnalyzing ? "Analyzing..." : "Analyze Image"}
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  item: {
    width: itemSize, // Make sure itemSize is defined
    height: itemSize, // Ensure itemSize is defined
    padding: 2,
  },

  photo: {
    width: "100%",
    height: "100%",
  },

  noPhotosText: {
    fontSize: 18,
    textAlign: "center",
    marginTop: 50,
  },

  fullScreenContainer: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
  },

  fullScreenPhoto: {
    width: "100%", // Make sure the photo takes the full width
    height: "100%", // Make sure the photo takes the full height
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
    backgroundColor: "rgba(28,28,30,0.92)", // More Apple-like dark color
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
});

export default Detail;
