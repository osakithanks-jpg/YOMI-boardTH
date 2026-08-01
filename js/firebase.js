/**
 * 選考進捗・ヨミ管理システム - Firebase / Firestore 連携・ログ管理・診断モジュール
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

// 診断情報グローバルステート (指示書 1項)
if (typeof window !== 'undefined') {
  window.DATA_SOURCE_DEBUG_INFO = {
    projectId: "selection-progress-app",
    databaseId: "(default)",
    collection: "selections",
    documentPath: "selections/{documentId}",
    authUid: "unauthenticated",
    dataSource: "unknown",
    loadedCount: 0,
    firstDocId: "-",
    lastLoadedAt: "-",
    localStorageCount: 0,
    indexedDbPersistence: false,
    rawCount: 0,
    filteredCount: 0,
    selectedConsultant: "ALL",
    selectedPeriod: "ALL",
    testDocId: "TEST_SHARED_RECORD_20260802",
    testDocExists: false,
    testDocValue: "-"
  };
}

export function initFirebase() {
  if (isFirebaseInitialized) return db;

  try {
    const config = getFirebaseConfig();
    
    // 指示書 3項: FIREBASE_CONFIG_CHECK ログ
    console.log("FIREBASE_CONFIG_CHECK", {
      projectId: config.projectId,
      appId: config.appId
    });

    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();

      // IndexedDB オフライン永続化の確認
      try {
        db.enablePersistence({ synchronizeTabs: true }).then(() => {
          if (window.DATA_SOURCE_DEBUG_INFO) window.DATA_SOURCE_DEBUG_INFO.indexedDbPersistence = true;
        }).catch(() => {
          if (window.DATA_SOURCE_DEBUG_INFO) window.DATA_SOURCE_DEBUG_INFO.indexedDbPersistence = false;
        });
      } catch (pe) {}

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
 * リアルタイムコレクション監視 (指示書 2, 5, 8, 10項)
 */
export function subscribeCollection(collectionName, onUpdate, onError) {
  const firestore = initFirebase();
  const config = getFirebaseConfig();
  const authUid = (typeof firebase !== 'undefined' && firebase.auth) ? (firebase.auth().currentUser?.uid || 'unauthenticated') : 'unauthenticated';

  // 指示書 2項: SHARED_DATA_REFERENCE ログ
  console.log("SHARED_DATA_REFERENCE", {
    projectId: config.projectId,
    databaseId: "(default)",
    collectionName,
    documentPath: `${collectionName}/{docId}`,
    authUid
  });

  if (!firestore) {
    if (window.DATA_SOURCE_DEBUG_INFO) window.DATA_SOURCE_DEBUG_INFO.dataSource = "localStorage";
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
        const fromCache = snapshot.metadata ? snapshot.metadata.fromCache : false;
        const hasPendingWrites = snapshot.metadata ? snapshot.metadata.hasPendingWrites : false;

        // 指示書 5項: FIRESTORE_SNAPSHOT_METADATA ログ
        console.log("FIRESTORE_SNAPSHOT_METADATA", {
          collectionName,
          fromCache,
          hasPendingWrites
        });

        // 診断情報の更新
        if (window.DATA_SOURCE_DEBUG_INFO) {
          window.DATA_SOURCE_DEBUG_INFO.projectId = config.projectId;
          window.DATA_SOURCE_DEBUG_INFO.collection = collectionName;
          window.DATA_SOURCE_DEBUG_INFO.authUid = authUid;
          window.DATA_SOURCE_DEBUG_INFO.dataSource = fromCache ? "Firestore cache" : "Firestore server";
          window.DATA_SOURCE_DEBUG_INFO.loadedCount = snapshot.size;
          window.DATA_SOURCE_DEBUG_INFO.firstDocId = snapshot.docs.length > 0 ? snapshot.docs[0].id : "-";
          window.DATA_SOURCE_DEBUG_INFO.lastLoadedAt = new Date().toLocaleTimeString();
        }

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

        if (window.DATA_SOURCE_DEBUG_INFO) window.DATA_SOURCE_DEBUG_INFO.dataSource = "unknown";
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
 * 明示的サーバーデータ直接フェッチ (指示書 5項: getDocsFromServer)
 */
export async function fetchCollectionFromServer(collectionName) {
  const firestore = initFirebase();
  if (!firestore) return [];

  try {
    const snapshot = await firestore.collection(collectionName).get({ source: 'server' });

    // 指示書 5項: FIRESTORE_SERVER_RESULT ログ
    console.log("FIRESTORE_SERVER_RESULT", {
      collectionName,
      count: snapshot.size,
      ids: snapshot.docs.map(doc => doc.id)
    });

    return snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn(`Server fetch for ${collectionName} failed:`, err);
    return [];
  }
}

/**
 * 特定1件のテストドキュメント直接検証 (指示書 9項: getDocFromServer)
 */
export async function verifyTestDocument(collectionName = "selections", testDocId = "TEST_SHARED_RECORD_20260802") {
  const firestore = initFirebase();
  if (!firestore) return null;

  try {
    const docRef = firestore.collection(collectionName).doc(testDocId);
    const snapshot = await docRef.get({ source: 'server' }).catch(() => docRef.get());

    const exists = snapshot.exists;
    const val = exists ? JSON.stringify(snapshot.data()).substring(0, 30) + "..." : "not found";

    if (window.DATA_SOURCE_DEBUG_INFO) {
      window.DATA_SOURCE_DEBUG_INFO.testDocId = testDocId;
      window.DATA_SOURCE_DEBUG_INFO.testDocExists = exists;
      window.DATA_SOURCE_DEBUG_INFO.testDocValue = val;
    }

    console.log("TEST_DOCUMENT_VERIFICATION", {
      testDocId,
      exists,
      data: exists ? snapshot.data() : null
    });

    return exists ? snapshot.data() : null;
  } catch (e) {
    console.warn("Test doc verification failed:", e);
    return null;
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
