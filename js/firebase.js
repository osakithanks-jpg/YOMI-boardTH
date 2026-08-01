/**
 * 選考進捗・ヨミ管理システム - Firebase / Firestore 連携・ログ管理モジュール
 */

// Firebase 設定の取得 (グローバル設定または環境変数フォールバック)
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
    
    // 指示書 3項: FIREBASE_CONFIG_CHECK ログ (機密情報除外)
    console.log("FIREBASE_CONFIG_CHECK", {
      projectId: config.projectId,
      appId: config.appId
    });

    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();
      isFirebaseInitialized = true;
    } else {
      console.warn("Firebase SDK is not loaded. Operating in offline/fallback mode.");
    }
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }

  return db;
}

/**
 * リアルタイムコレクション監視 (指示書 5, 8, 10項)
 */
export function subscribeCollection(collectionName, onUpdate, onError) {
  const firestore = initFirebase();
  if (!firestore) {
    if (onError) onError(new Error("Firestore is not available"));
    return () => {};
  }

  // 指示書 8項: SNAPSHOT_LISTENER_STARTED ログ
  console.log("SNAPSHOT_LISTENER_STARTED", { collectionName });
  // 指示書 5項: FIRESTORE_LOAD_START ログ
  console.log("FIRESTORE_LOAD_START", { collectionName });

  try {
    const unsubscribe = firestore.collection(collectionName).onSnapshot(
      (snapshot) => {
        // 指示書 8項: SNAPSHOT_RECEIVED ログ
        console.log("SNAPSHOT_RECEIVED", {
          collectionName,
          documentCount: snapshot.size
        });

        // 指示書 5項: FIRESTORE_LOAD_SUCCESS ログ
        console.log("FIRESTORE_LOAD_SUCCESS", {
          collectionName,
          documentCount: snapshot.size
        });

        const dataList = snapshot.docs.map(doc => ({
          docId: doc.id,
          ...doc.data()
        }));

        // 指示書 5項: FIRESTORE_LOADED_DATA ログ
        console.log("FIRESTORE_LOADED_DATA", dataList);

        if (onUpdate) onUpdate(dataList);
      },
      (error) => {
        // 指示書 5, 10項: FIRESTORE_LOAD_ERROR ログ
        console.error("FIRESTORE_LOAD_ERROR", {
          collectionName,
          code: error.code,
          message: error.message
        });

        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    console.error("FIRESTORE_LOAD_ERROR", {
      collectionName,
      code: err.code || "unknown",
      message: err.message
    });
    if (onError) onError(err);
    return () => {};
  }
}

/**
 * Firestore ドキュメント保存 (指示書 4, 10項)
 */
export async function saveDocument(collectionName, docId, payload) {
  const firestore = initFirebase();
  
  // 指示書 4項: FIRESTORE_SAVE_START ログ
  console.log("FIRESTORE_SAVE_START", {
    collectionName,
    payload
  });

  if (!firestore) {
    console.warn("Firestore not initialized. Local cache only.");
    return false;
  }

  try {
    const targetId = docId || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
    await firestore.collection(collectionName).doc(targetId).set(payload, { merge: true });

    // 指示書 4項: FIRESTORE_SAVE_SUCCESS ログ
    console.log("FIRESTORE_SAVE_SUCCESS", {
      collectionName,
      documentId: targetId
    });

    return true;
  } catch (error) {
    // 指示書 4, 10項: FIRESTORE_SAVE_ERROR ログ
    console.error("FIRESTORE_SAVE_ERROR", {
      collectionName,
      code: error.code,
      message: error.message
    });
    throw error;
  }
}

/**
 * Firestore ドキュメント削除
 */
export async function deleteDocument(collectionName, docId) {
  const firestore = initFirebase();
  if (!firestore || !docId) return false;

  try {
    await firestore.collection(collectionName).doc(docId).delete();
    return true;
  } catch (error) {
    console.error("FIRESTORE_DELETE_ERROR", {
      collectionName,
      docId,
      code: error.code,
      message: error.message
    });
    throw error;
  }
}
