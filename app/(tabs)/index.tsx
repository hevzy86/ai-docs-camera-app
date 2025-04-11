import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
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

export default function CameraTab() {
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [zoom, setZoom] = useState(0);
  const [capturedPhotos, setCapturedPhotos] = useState<Array<{ uri: string }>>(
    []
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [isBarcodeMode, setIsBarcodeMode] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<string | null>(null);
  const [lastCapturedPhoto, setLastCapturedPhoto] = useState<{
    uri: string;
  } | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();

  useEffect(() => {
    loadSavedPhotos();
  }, []); // Use an empty array instead of [1]

  const loadSavedPhotos = useCallback(async () => {
    try {
      const savedPhotos = await AsyncStorage.getItem("capturedPhotos");
      if (savedPhotos) {
        setCapturedPhotos(JSON.parse(savedPhotos));
      }
    } catch (error) {
      console.error("Error loading saved photos:", error);
    }
  }, []);

  const savePhoto = useCallback(
    async (newPhoto: { uri: string }) => {
      try {
        console.log(`Saving new photo: ${newPhoto.uri.substring(0, 30)}...`);
        
        // First load the latest photos from storage to ensure we have the most up-to-date list
        const savedPhotos = await AsyncStorage.getItem("capturedPhotos");
        let currentPhotos = [];
        
        if (savedPhotos) {
          currentPhotos = JSON.parse(savedPhotos);
          console.log(`Loaded ${currentPhotos.length} existing photos from storage`);
        }
        
        // Add the new photo to the beginning of the array
        const updatedPhotos = [newPhoto, ...currentPhotos];
        console.log(`Total photos after adding new one: ${updatedPhotos.length}`);

        // Save to AsyncStorage
        await AsyncStorage.setItem(
          "capturedPhotos",
          JSON.stringify(updatedPhotos)
        );

        // Update state with the new array
        setCapturedPhotos(updatedPhotos);
        console.log("Photo saved successfully");
      } catch (error) {
        console.error("Failed to save photo", error);
      }
    },
    [] // Remove capturedPhotos from dependency array to avoid stale state
  );

  const toggleCameraFacing = useCallback(() => {
    setFacing((current) => (current === "back" ? "front" : "back"));
  }, []);

  const handleZoomChange = useCallback((value: number) => {
    setZoom(value);
  }, []);

  const takePicture = useCallback(async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1,
          base64: false,
          exif: false,
        });

        if (photo?.uri) {
          // Ensure photo and photo.uri exist
          await savePhoto({ uri: photo.uri });
          // Set the last captured photo to show the analyze button
          setLastCapturedPhoto({ uri: photo.uri });
        } else {
          console.error("Captured photo is undefined or invalid.");
        }
      } catch (error) {
        console.error("Error taking picture:", error);
      }
    }
  }, [savePhoto]);

  const analyzeLastPhoto = useCallback(() => {
    if (lastCapturedPhoto) {
      console.log(`Navigating to Detail screen with photo: ${lastCapturedPhoto.uri.substring(0, 30)}...`);
      
      // Navigate to the detail screen with query parameters to indicate immediate analysis
      // and include the URI of the photo to analyze
      router.push({
        pathname: "/Detail",
        params: { 
          analyzeImmediately: "true",
          photoUri: lastCapturedPhoto.uri 
        },
      });
      
      // Clear the last captured photo state
      setLastCapturedPhoto(null);
    }
  }, [lastCapturedPhoto, router]);

  const toggleBarcodeMode = useCallback(() => {
    setIsBarcodeMode((prev) => !prev);
  }, []);

  const handleBarCodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      setBarcodeResult(data);
    },
    [] // Dependencies array should be here
  );

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={requestPermission}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        zoom={zoom}
        barcodeScannerSettings={{
          barcodeTypes: [
            "qr",
            "ean13",
            "ean8",
            "pdf417",
            "aztec",
            "datamatrix",
          ],
        }}
        onBarcodeScanned={isBarcodeMode ? handleBarCodeScanned : undefined}
      >
        <View style={styles.controlsContainer}>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.button}
              onPress={toggleCameraFacing}
            >
              <Text style={styles.buttonText}>Flip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.button}
              onPress={toggleBarcodeMode}
            >
              <Text style={styles.buttonText}>
                {isBarcodeMode ? "Photo Mode" : "Barcode Mode"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.text}>Zoom: {zoom.toFixed(1)}x</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              value={zoom}
              onValueChange={handleZoomChange}
            />
          </View>

          {!isBarcodeMode && (
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.captureButton}
                onPress={takePicture}
              >
                <Text style={styles.captureButtonText}>Take Photo</Text>
              </TouchableOpacity>
              {lastCapturedPhoto && (
                <TouchableOpacity
                  style={styles.analyzeButton}
                  onPress={analyzeLastPhoto}
                >
                  <Text style={styles.analyzeButtonText}>Analyze</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </CameraView>

      <Modal
        animationType="slide"
        transparent={true}
        visible={!!barcodeResult}
        onRequestClose={() => setBarcodeResult(null)}
      >
        <View style={styles.modalView}>
          <Text style={styles.modalText}>Barcode Detected:</Text>
          <Text style={styles.barcodeText}>{barcodeResult}</Text>
          <TouchableOpacity
            style={[styles.button, styles.buttonClose]}
            onPress={() => setBarcodeResult(null)}
          >
            <Text style={styles.buttonText}>Close</Text>

            <Text style={styles.buttonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  controlsContainer: {
    position: "absolute",
    bottom: 0,
    left: 0, // You might want to specify the left position for controls container
    right: 0, // You might also want to specify the right position
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginBottom: 20,
  },

  button: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 5,
  },
  buttonText: {
    color: "#000",
    fontSize: 16,
  },

  text: {
    fontSize: 16,
    color: "#fff",
  },
  slider: {
    flex: 1,
    marginLeft: 10,
  },
  captureButton: {
    backgroundColor: "#fff",
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
  },

  captureButtonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "bold",
  },
  analyzeButton: {
    backgroundColor: "#4CAF50", // Green color for the analyze button
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    marginLeft: 10,
  },
  analyzeButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalView: {
    margin: 20,
    backgroundColor: "white",
    borderRadius: 20,
    padding: 35,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalText: {
    marginBottom: 15,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  barcodeText: {
    marginBottom: 15,
    textAlign: "center",
    fontSize: 16,
  },

  buttonClose: {
    backgroundColor: "#2196F3",
    marginTop: 10,
  },
});
