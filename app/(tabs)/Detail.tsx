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
  const [selectedPhotos, setSelectedPhotos] = useState<Set<PhotoItem>>(new Set());
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const scrollViewRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams();
  const analyzeImmediately = params.analyzeImmediately === "true";

  // Animation value for panel height
  const panelHeight = useRef(new Animated.Value(1)).current;

  // Storage keys for AsyncStorage
  const STORAGE_KEYS = {
    PHOTOS: "capturedPhotos", // Use a simple key for photos
    ANALYSES: "analyses",     // Use a simple key for analyses
    LANGUAGE: "selectedLanguage"
  };

  // Load saved photos
  const loadSavedPhotos = useCallback(async () => {
    try {
      // Get the latest photos from storage
      console.log("Fetching photos from storage...");
      const savedPhotos = await AsyncStorage.getItem(STORAGE_KEYS.PHOTOS);
      
      if (!savedPhotos) {
        console.log("No photos found in storage");
        // If no photos in storage, make sure state is empty
        setCapturedPhotos([]);
        return;
      }
      
      const photosArray = JSON.parse(savedPhotos);
      console.log(`Found ${photosArray.length} photos in storage`);
      
      // ALWAYS use photos from storage to ensure consistency
      // This prevents deleted photos from reappearing
      setCapturedPhotos(photosArray);
      console.log(`Updated state with ${photosArray.length} photos from storage`);

      // Load language preference
      await loadLanguagePreference();
    } catch (error) {
      console.error("Failed to load photos", error);
    }
  }, []);  // Remove capturedPhotos from dependency array to avoid stale state

  // Save photos to storage
  const savePhotosToStorage = async (photos: PhotoItem[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.PHOTOS, JSON.stringify(photos));
      console.log(`Saved ${photos.length} photos to storage`);
    } catch (error) {
      console.error("Failed to save photos to storage", error);
    }
  };

  // Load analysis for a specific photo
  const loadAnalysisForPhoto = async (photoUri: string): Promise<string | null> => {
    try {
      // Get all analyses from storage
      const savedAnalyses = await AsyncStorage.getItem(STORAGE_KEYS.ANALYSES);
      if (!savedAnalyses) {
        return null;
      }

      const analyses = JSON.parse(savedAnalyses);
      
      // Check if we have an analysis for this photo in the current language
      const key = `${photoUri}_${selectedLanguage}`;
      if (analyses[key]) {
        console.log(`Found analysis for photo in ${selectedLanguage}`);
        return analyses[key];
      }
      
      // If not found in current language, check if we have it in any language
      // This allows fallback to any available analysis
      const fallbackKey = Object.keys(analyses).find(k => k.startsWith(photoUri));
      if (fallbackKey) {
        console.log(`Found analysis in different language, will need translation`);
        return analyses[fallbackKey];
      }
      
      return null;
    } catch (error) {
      console.error("Error loading analysis for photo:", error);
      return null;
    }
  };

  // Save analysis for a specific photo
  const saveAnalysisForPhoto = async (photoUri: string, analysis: string) => {
    try {
      // Get existing analyses
      const savedAnalyses = await AsyncStorage.getItem(STORAGE_KEYS.ANALYSES);
      const analyses = savedAnalyses ? JSON.parse(savedAnalyses) : {};
      
      // Add or update the analysis for this photo in the current language
      const key = `${photoUri}_${selectedLanguage}`;
      analyses[key] = analysis;
      
      // Save back to storage
      await AsyncStorage.setItem(STORAGE_KEYS.ANALYSES, JSON.stringify(analyses));
      console.log(`Saved analysis for photo in ${selectedLanguage}`);
    } catch (error) {
      console.error("Error saving analysis for photo:", error);
    }
  };

  // Delete analyses for a specific photo (all languages)
  const deleteAnalysesForPhoto = async (photoUri: string) => {
    try {
      // Get existing analyses
      const savedAnalyses = await AsyncStorage.getItem(STORAGE_KEYS.ANALYSES);
      if (!savedAnalyses) {
        return;
      }
      
      const analyses = JSON.parse(savedAnalyses);
      
      // Find and remove all analyses for this photo (in any language)
      const keysToDelete = Object.keys(analyses).filter(key => key.startsWith(photoUri));
      
      if (keysToDelete.length > 0) {
        keysToDelete.forEach(key => {
          delete analyses[key];
        });
        
        // Save back to storage
        await AsyncStorage.setItem(STORAGE_KEYS.ANALYSES, JSON.stringify(analyses));
        console.log(`Deleted ${keysToDelete.length} analyses for photo`);
      }
    } catch (error) {
      console.error("Error deleting analyses for photo:", error);
    }
  };

  // Delete selected photos
  const deleteSelectedPhotos = async () => {
    try {
      console.log(`Deleting ${selectedPhotos.size} photos`);
      
      // Create a new array without the selected photos
      const updatedPhotos = capturedPhotos.filter(
        (photo) => !selectedPhotos.has(photo)
      );
      
      console.log(`Filtered photos: ${updatedPhotos.length} remaining after deletion`);
      
      // Update state first for immediate UI feedback
      setCapturedPhotos(updatedPhotos);
      
      // Delete analyses for each deleted photo
      for (const photo of Array.from(selectedPhotos)) {
        await deleteAnalysesForPhoto(photo.uri);
        console.log(`Deleted analyses for photo: ${photo.uri.substring(0, 30)}...`);
      }
      
      // Save the updated photos list to storage
      await savePhotosToStorage(updatedPhotos);
      console.log(`Saved updated photo list to storage: ${updatedPhotos.length} photos`);
      
      // Reset selection state
      setSelectedPhotos(new Set());
      setIsSelectionMode(false);
      setShowDeleteConfirmation(false);
      
      console.log(`Successfully deleted ${selectedPhotos.size} photos`);
    } catch (error) {
      console.error("Error deleting photos:", error);
    }
  };

  // Load saved language preference
  const loadLanguagePreference = useCallback(async () => {
    try {
      const savedLanguage = await AsyncStorage.getItem(STORAGE_KEYS.LANGUAGE);
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
      await AsyncStorage.setItem(STORAGE_KEYS.LANGUAGE, language);
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

      // Save the translation to cache if we have a selected photo
      if (selectedPhoto) {
        await saveAnalysisForPhoto(selectedPhoto.uri, translatedText);
      }

      return translatedText;
    } catch (error) {
      console.error("Error translating text:", error);
      return `Error translating text: ${error}`;
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Translate all cached analyses to the new language
  const translateAllCachedAnalyses = async (targetLanguage: Language) => {
    try {
      console.log("Translating all cached analyses to", targetLanguage);

      // Get all analyses
      const savedAnalyses = await AsyncStorage.getItem(STORAGE_KEYS.ANALYSES);
      if (!savedAnalyses) {
        return;
      }
      
      const analyses = JSON.parse(savedAnalyses);
      
      // Find analyses that don't have a translation in the target language
      const photoUris = new Set<string>();
      
      // Extract unique photo URIs
      Object.keys(analyses).forEach(key => {
        const [uri] = key.split('_');
        photoUris.add(uri);
      });
      
      // For each unique photo URI, check if we need to translate
      for (const uri of photoUris) {
        const targetKey = `${uri}_${targetLanguage}`;
        
        // Skip if we already have a translation in the target language
        if (analyses[targetKey]) {
          continue;
        }
        
        // Find any analysis for this photo to translate
        const sourceKey = Object.keys(analyses).find(k => k.startsWith(uri) && !k.endsWith(targetLanguage));
        
        if (sourceKey && analyses[sourceKey]) {
          console.log(`Translating analysis for ${uri.substring(0, 20)}...`);
          
          // Translate in background
          translateAnalysisInBackground(analyses[sourceKey], uri, targetLanguage);
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

      // Save the translation to storage
      await saveAnalysisForPhoto(imageUri, translatedText);
    } catch (error) {
      console.error("Error in background translation:", error);
    }
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

  // Load photos when screen gains focus
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadSavedPhotos();
    });

    return () => unsubscribe();
  }, [navigation, loadSavedPhotos]);

  // Effect to handle automatic analysis when navigated with analyzeImmediately=true
  useEffect(() => {
    const handleImmediateAnalysis = async () => {
      console.log(`handleImmediateAnalysis called - analyzeImmediately: ${analyzeImmediately}, photos count: ${capturedPhotos.length}`);
      
      if (analyzeImmediately) {
        // Check if we have a direct photoUri parameter from the camera
        const photoUri = params.photoUri as string | undefined;
        
        if (photoUri) {
          console.log(`Using direct photoUri parameter: ${photoUri.substring(0, 30)}...`);
          
          // Create a PhotoItem from the URI
          const photoItem: PhotoItem = { uri: photoUri };
          
          // Open the photo
          await openPhoto(photoItem);
          console.log("Photo opened from direct URI, preparing to analyze...");
          
          // Start analyzing after a short delay to ensure the UI is updated
          setTimeout(() => {
            console.log("Starting analysis of photo from direct URI...");
            analyzeImage(photoUri);
          }, 500);
        } 
        // Fallback to using the most recent photo from the array
        else if (capturedPhotos.length > 0) {
          // Get the most recent photo (first in the array)
          const mostRecentPhoto = capturedPhotos[0];
          console.log(`Using most recent photo from array: ${mostRecentPhoto.uri.substring(0, 30)}...`);

          // Open the photo
          await openPhoto(mostRecentPhoto);
          console.log("Photo opened from array, preparing to analyze...");

          // Start analyzing after a short delay to ensure the UI is updated
          setTimeout(() => {
            if (mostRecentPhoto) {
              console.log("Starting analysis of most recent photo from array...");
              analyzeImage(mostRecentPhoto.uri);
            } else {
              console.error("Most recent photo is no longer available");
            }
          }, 500);
        } else {
          console.warn("analyzeImmediately is true but no photos available");
        }
      }
    };

    // Load photos first, then handle immediate analysis
    const initializeAndAnalyze = async () => {
      await loadSavedPhotos();
      handleImmediateAnalysis();
    };

    initializeAndAnalyze();
  }, [analyzeImmediately, params.photoUri]);

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

    // Try to load cached analysis immediately when opening a photo
    try {
      const analysis = await loadAnalysisForPhoto(item.uri);
      if (analysis) {
        console.log("Found analysis when opening photo");
        setAiAnalysis(analysis);
      } else {
        console.log("No cached analysis found for this photo");
      }
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

      console.log(
        "Analyzing image with URI:",
        imageUri.substring(0, 30) + "..."
      );

      // Check if we already have an analysis for this photo
      const existingAnalysis = await loadAnalysisForPhoto(imageUri);
      if (existingAnalysis) {
        console.log("Found existing analysis, using cached version");
        setAiAnalysis(existingAnalysis);
        setIsAnalyzing(false);
        return existingAnalysis;
      }

      // If no cached analysis, perform a new analysis
      setAnalysisStep("Optimizing image...");

      // Compress and resize the image for faster upload
      const manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800 } }], // Resize to 800px width
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG } // Compress to 70% quality
      );
      
      console.log(`Optimized image size: ${manipResult.width}x${manipResult.height}`);
      setAnalysisStep("Loading image...");

      // Load the optimized image and convert to base64
      const response = await fetch(manipResult.uri);
      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64data = reader.result as string;
            // Remove the data URL prefix
            const base64Image = base64data.split(",")[1];

            setAnalysisStep("Sending to AI for analysis...");
            console.log("Sending request to OpenAI..."); // Debug log
            
            // Start a timeout to show progress updates to the user
            let dots = 0;
            const progressInterval = setInterval(() => {
              dots = (dots + 1) % 4;
              setAnalysisStep(`Analyzing image${'.'.repeat(dots)}`);
            }, 800);

            let promptText =
              "Please analyze this image and provide a description based on what you see:\n\n" +
              "If this is a document (like an invoice, certificate, ID, etc.):\n" +
              "1. **Document Type and Purpose**\n" +
              "   - Identify the type and purpose of the document\n\n" +
              "2. **Key Information**\n" +
              "   - Extract important dates, numbers, amounts, and other key details\n\n" +
              "3. **Additional Information**\n" +
              "   - Note any other relevant details\n\n" +
              "If this is NOT a document (like a person, scene, object, etc.):\n" +
              "- Provide a general description of what's in the image\n" +
              "- For people: describe general appearance, clothing, setting, and posture\n" +
              "- DO NOT identify or name any individuals in the image\n" +
              "- Focus on objective visual elements rather than making assumptions";

            // Use different prompts based on language
            if (selectedLanguage === "es") {
              promptText =
                "Por favor, analiza esta imagen y proporciona una descripción basada en lo que ves:\n\n" +
                "Si es un documento (como una factura, certificado, identificación, etc.):\n" +
                "1. **Tipo y Propósito del Documento**\n" +
                "   - Identifica el tipo y propósito del documento\n\n" +
                "2. **Información Clave**\n" +
                "   - Extrae fechas importantes, números, cantidades y otros detalles clave\n\n" +
                "3. **Información Adicional**\n" +
                "   - Anota cualquier otro detalle relevante\n\n" +
                "Si NO es un documento (como una persona, escena, objeto, etc.):\n" +
                "- Proporciona una descripción general de lo que hay en la imagen\n" +
                "- Para personas: describe apariencia general, ropa, entorno y postura\n" +
                "- NO identifiques ni nombres a ninguna persona en la imagen\n" +
                "- Concéntrate en elementos visuales objetivos en lugar de hacer suposiciones";
            } else if (selectedLanguage === "ru") {
              promptText =
                "Пожалуйста, проанализируйте это изображение и предоставьте описание на основе того, что вы видите:\n\n" +
                "Если это документ (например, счет, сертификат, удостоверение личности и т.д.):\n" +
                "1. **Тип и назначение документa**\n" +
                "   - Определите тип и назначение документa\n\n" +
                "2. **Ключевая информация**\n" +
                "   - Извлеките важные даты, номера, суммы и другие ключевые детали\n\n" +
                "3. **Дополнительная информация**\n" +
                "   - Отметьте любые другие соответствующие детали\n\n" +
                "Если это НЕ документ (например, человек, сцена, объект и т.д.):\n" +
                "- Предоставьте общее описание того, что изображено на снимке\n" +
                "- Для людей: опишите общий вид, одежду, окружение и позу\n" +
                "- НЕ идентифицируйте и не называйте людей на изображении\n" +
                "- Сосредоточьтесь на объективных визуальных элементах, а не на предположениях";
            }

            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini", // Use the mini model for faster responses
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
              max_tokens: 500, // Limit response length for faster generation
            });

            // Clear the progress interval
            clearInterval(progressInterval);
            
            console.log("Received response from OpenAI"); // Debug log
            setAnalysisStep("Analysis complete!");

            const analysisResult =
              response.choices[0].message.content || "No analysis available";

            // Save the analysis result
            await saveAnalysisForPhoto(imageUri, analysisResult);
            
            // Update UI
            setAiAnalysis(analysisResult);
            setIsAnalyzing(false);
            
            // Return the result
            resolve(analysisResult);
          } catch (error) {
            console.error("Error in analysis:", error);
            setAiAnalysis(`Error analyzing image: ${error}`);
            setIsAnalyzing(false);
            reject(error);
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
      return null;
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
  const togglePhotoSelection = (photo: PhotoItem) => {
    const newSelectedPhotos = new Set(selectedPhotos);
    if (newSelectedPhotos.has(photo)) {
      newSelectedPhotos.delete(photo);
    } else {
      newSelectedPhotos.add(photo);
    }
    setSelectedPhotos(newSelectedPhotos);
  };

  const renderItem = ({ item }: { item: PhotoItem }) => {
    const isSelected = selectedPhotos.has(item);

    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.selectedItem]}
        onPress={() => {
          if (isSelectionMode) {
            togglePhotoSelection(item);
          } else {
            openPhoto(item);
          }
        }}
        onLongPress={() => {
          if (!isSelectionMode) {
            setIsSelectionMode(true);
            togglePhotoSelection(item);
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

  // Handle language change
  const handleLanguageChange = async (language: Language) => {
    console.log(`Changing language to ${language}`);
    
    // Save the new language preference
    await saveLanguagePreference(language);
    
    // Update the state
    setSelectedLanguage(language);
    
    // If we have a selected photo with analysis, translate it
    if (selectedPhoto && aiAnalysis) {
      await translateAnalysis(aiAnalysis, language);
    }
    
    // Optionally translate all cached analyses in background
    translateAllCachedAnalyses(language);
  };

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
              onPress={() => handleLanguageChange(language.code)}
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

  // Toggle panel with animation
  const togglePanel = () => {
    setIsAnalysisCollapsed(!isAnalysisCollapsed);
    Animated.timing(panelHeight, {
      toValue: isAnalysisCollapsed ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

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
