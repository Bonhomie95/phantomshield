/**
 * In-app rating prompt. ASO ranking lives on review volume/velocity, so we ask
 * exactly once, at the user's happiest moment (right after they see the product
 * work — e.g. a successful catch), never randomly.
 */
import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ASKED_KEY = 'ps_rating_asked_v1';

export async function maybeAskForReview(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(ASKED_KEY)) return;
    const available = await StoreReview.hasAction();
    if (!available) return;
    await AsyncStorage.setItem(ASKED_KEY, '1');
    await StoreReview.requestReview();
  } catch {
    // never throw into product code
  }
}
