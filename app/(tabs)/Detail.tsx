import { FlatList, Image } from "react-native";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
  SafeAreaView,
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
// import { useNavigation, NavigationProp } from "@react-navigation/native";

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

const Detail = () => {
  const [capturedPhotos, setCapturedPhotos] = useState<
    PhotoItem[]
  >([]);
  const [selectedPhoto, setSelectedPhoto] =
    useState<PhotoItem | null>(null);
  const navigation =
    useNavigation<NavigationProp<ParamListBase>>();

  const loadSavedPhotos = useCallback(async () => {
    try {
      const savedPhotos = await AsyncStorage.getItem(
        "capturedPhotos"
      );
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
        <TouchableOpacity
          style={styles.closeButton}
          onPress={closePhoto}
        >
          <Text style={styles.closeButtonText}>@</Text>
        </TouchableOpacity>

        <Image
          source={{ uri: selectedPhoto?.uri }}
          style={styles.fullScreenPhoto}
          resizeMode="contain"
        />
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
        <Text style={styles.noPhotosText}>
          No photos captured yet.
        </Text>
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
    position: "absolute",
    top: 40,
    right: 20,
    zIndex: 1,
  },

  closeButtonText: {
    color: "white",
    fontSize: 36, // Fixed typo here
  },
});
export default Detail;
