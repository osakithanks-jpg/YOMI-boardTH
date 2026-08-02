/**
 * 選考進捗・ヨミ管理システム - Firebase / Firestore リアルタイム同期モジュール
 */

const getFirebaseConfig = () => {
  if (typeof window !== 'undefined' && window.FIREBASE_CONFIG) {
    return window.FIREBASE_CONFIG;
  }
  
  return {
    projectId: "selection-progress-app",
    appId: "1:100000000000:web:abcdef1234567890",
    authDomain: "selection-progress-app.firebaseapp.com",
    storageBucket: "selection-progress-app.appspot.com"
  };
};

let db = null;
let isFirebaseInitialized = false;

export function initFirebase() {
  if (isFirebaseInitialized) return db;

  try {
    const config = getFirebaseConfig();

    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();
      isFirebaseInitialized = true;
    } else {
      console.warn("Firebase SDK is not loaded.");
    }
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }

  return db;
}

/**
 * 指示書準拠: Firestore onSnapshot リアルタイムストリーム監視
 */
export function listenCollection(collectionName, callback) {
  const firestore = initFirebase();
  if (!firestore) return () => {};

  return firestore.collection(collectionName).onSnapshot(
    (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        docId: doc.id,
        id: doc.id,
        ...doc.data()
      }));
      callback(data);
    },
    (error) => {
      console.error(`Firestore snapshot error for ${collectionName}:`, error);
    }
  );
}

/**
 * Firestore 直接書き込み (新規・更新)
 */
export async function saveFirestoreDoc(collectionName, docId, payload) {
  const firestore = initFirebase();
  if (!firestore) return false;

  const cleanPayload = JSON.parse(JSON.stringify(payload, (key, value) => {
    return value === undefined ? null : value;
  }));

  const targetId = String(docId || payload.selectionId || payload.companyId || payload.jobId || payload.candidateId || payload.consultantId || payload.targetId || payload.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)));

  try {
    await firestore.collection(collectionName).doc(targetId).set(cleanPayload, { merge: true });
    return true;
  } catch (error) {
    console.error(`Firestore save error (${collectionName}/${targetId}):`, error);
    throw error;
  }
}

/**
 * Firestore 直接削除
 */
export async function deleteFirestoreDoc(collectionName, docId) {
  const firestore = initFirebase();
  if (!firestore || !docId) return false;

  try {
    await firestore.collection(collectionName).doc(String(docId)).delete();
    return true;
  } catch (error) {
    console.error(`Firestore delete error (${collectionName}/${docId}):`, error);
    throw error;
  }
}
