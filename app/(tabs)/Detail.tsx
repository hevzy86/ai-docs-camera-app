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
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  // Simple cache for image analysis results
  const analysisCache = useRef<Record<string, string>>({});

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

  const loadSavedPhotos = useCallback(async () => {
    try {
      const savedPhotos = await AsyncStorage.getItem("capturedPhotos");
      if (savedPhotos) {
        setCapturedPhotos(JSON.parse(savedPhotos));
      }
    } catch (error) {
      console.error("Failed to load photos", error);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadSavedPhotos();
    });

    return () => unsubscribe();
  }, [navigation, loadSavedPhotos]);

  const openPhoto = (item: PhotoItem) => {
    setSelectedPhoto(item);
  };

  const closePhoto = () => {
    setSelectedPhoto(null);
  };

  const analyzeImage = async (imageUri: string) => {
    try {
      setIsAnalyzing(true);
      setAiAnalysis(null);

      // Check cache first
      if (analysisCache.current[imageUri]) {
        setAnalysisStep("Loading from cache...");
        setTimeout(() => {
          setAiAnalysis(analysisCache.current[imageUri]);
          setIsAnalyzing(false);
        }, 500); // Small delay to show loading from cache
        return analysisCache.current[imageUri];
      }

      if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
        throw new Error("OpenAI API key is not configured");
      }

      // Resize and compress the image
      setAnalysisStep("Optimizing image...");
      const optimizedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800 } }], // Resize to 800px width
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      // First, fetch the optimized image
      setAnalysisStep("Processing image...");
      const response = await fetch(optimizedImage.uri);
      const blob = await response.blob();

      // Convert blob to base64
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
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

            // Cache the result
            analysisCache.current[imageUri] = analysisResult;

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
          <View style={styles.analysisContainer}>
            <ScrollView style={styles.scrollView}>
              <Text style={styles.analysisText}>{aiAnalysis}</Text>
            </ScrollView>
          </View>
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
    backgroundColor: "rgba(0,0,0,0.8)",
    padding: 20,
    maxHeight: "40%",
  },

  scrollView: {
    flexGrow: 0,
  },

  analysisText: {
    color: "white",
    fontSize: 16,
    lineHeight: 24,
  },
});

export default Detail;
