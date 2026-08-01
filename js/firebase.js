/**
 * 選考進捗・ヨミ管理システム - Firebase / Firestore 連携・診断モジュール
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
    
    console.log("FIREBASE_CONFIG_CHECK", {
      projectId: config.projectId,
      appId: config.appId
    });

    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();

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
 * リアルタイムコレクション監視
 */
export function subscribeCollection(collectionName, onUpdate, onError) {
  const firestore = initFirebase();
  const config = getFirebaseConfig();
  const authUid = (typeof firebase !== 'undefined' && firebase.auth) ? (firebase.auth().currentUser?.uid || 'unauthenticated') : 'unauthenticated';

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

  console.log("SNAPSHOT_LISTENER_STARTED", { collectionName });
  console.log("FIRESTORE_LOAD_START", { collectionName });

  try {
    const unsubscribe = firestore.collection(collectionName).onSnapshot(
      (snapshot) => {
        const fromCache = snapshot.metadata ? snapshot.metadata.fromCache : false;
        const hasPendingWrites = snapshot.metadata ? snapshot.metadata.hasPendingWrites : false;

        console.log("FIRESTORE_SNAPSHOT_METADATA", {
          collectionName,
          fromCache,
          hasPendingWrites
        });

        if (window.DATA_SOURCE_DEBUG_INFO) {
          window.DATA_SOURCE_DEBUG_INFO.projectId = config.projectId;
          window.DATA_SOURCE_DEBUG_INFO.collection = collectionName;
          window.DATA_SOURCE_DEBUG_INFO.authUid = authUid;
          window.DATA_SOURCE_DEBUG_INFO.dataSource = fromCache ? "Firestore cache" : "Firestore server";
          window.DATA_SOURCE_DEBUG_INFO.loadedCount = snapshot.size;
          window.DATA_SOURCE_DEBUG_INFO.firstDocId = snapshot.docs.length > 0 ? snapshot.docs[0].id : "-";
          window.DATA_SOURCE_DEBUG_INFO.lastLoadedAt = new Date().toLocaleTimeString();
        }

        console.log("SNAPSHOT_RECEIVED", { collectionName, documentCount: snapshot.size });
        console.log("FIRESTORE_LOAD_SUCCESS", { collectionName, documentCount: snapshot.size });

        const dataList = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));
        console.log("FIRESTORE_LOADED_DATA", dataList);

        if (onUpdate) onUpdate(dataList);
      },
      (error) => {
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
 * 指示書 2, 3, 5項: 強制切り分け用 syncDiagnostics/shared-test サーバー直接取得 ＆ 自動作成
 */
export async function fetchSyncDiagnosticFromServer() {
  const firestore = initFirebase();
  const config = getFirebaseConfig();
  const authUid = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : 'unauthenticated';

  if (!firestore) {
    return {
      success: false,
      error: { code: 'SDK_NOT_LOADED', message: 'Firebase SDK / Firestore is not initialized' }
    };
  }

  const collectionName = "syncDiagnostics";
  const docId = "shared-test";
  const docRef = firestore.collection(collectionName).doc(docId);

  // 1. 初回作成またはデータ確定
  const initialPayload = {
    message: "COMMON DATA TEST 2026-08-02",
    testNumber: 8202,
    updatedBy: "Antigravity",
    updatedAt: new Date().toISOString()
  };

  try {
    // まずサーバーからの直接取得を試みる
    let snapshot;
    try {
      snapshot = await docRef.get({ source: 'server' });
    } catch (serverErr) {
      // ドキュメント未存在または初回読み込み失敗の場合に作成
      await docRef.set(initialPayload, { merge: true });
      snapshot = await docRef.get({ source: 'server' });
    }

    if (!snapshot.exists) {
      await docRef.set(initialPayload, { merge: true });
      snapshot = await docRef.get({ source: 'server' });
    }

    const data = snapshot.data();

    return {
      success: true,
      projectId: config.projectId,
      databaseId: "(default)",
      documentPath: `${collectionName}/${docId}`,
      exists: snapshot.exists,
      message: data.message || "COMMON DATA TEST 2026-08-02",
      testNumber: data.testNumber || 8202,
      updatedBy: data.updatedBy || "Antigravity",
      updatedAt: data.updatedAt || new Date().toISOString(),
      loadedFrom: "Firestore server",
      loadedAt: new Date().toLocaleTimeString(),
      authUid
    };
  } catch (error) {
    console.error("FIRESTORE DIRECT READ FAILED:", error);
    return {
      success: false,
      projectId: config.projectId,
      databaseId: "(default)",
      documentPath: `${collectionName}/${docId}`,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message || String(error)
      }
    };
  }
}

/**
 * 指示書 6項: 既存画面用「Firestoreサーバーから再読込」直接フェッチ関数
 */
export async function fetchSelectionsFromServerDirect(collectionName = 'selections') {
  const firestore = initFirebase();
  if (!firestore) {
    return { success: false, error: 'Firestore is not initialized' };
  }

  try {
    const snapshot = await firestore.collection(collectionName).get({ source: 'server' });
    const docs = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

    const result = {
      success: true,
      loadedFrom: "Firestore server",
      count: snapshot.size,
      firstDocId: docs.length > 0 ? docs[0].docId : "-",
      lastDocId: docs.length > 0 ? docs[docs.length - 1].docId : "-",
      loadedAt: new Date().toLocaleTimeString(),
      items: docs
    };

    console.log("FIRESTORE_DIRECT_SELECTIONS_FETCH", result);
    return result;
  } catch (error) {
    console.error("FIRESTORE DIRECT SELECTIONS FETCH FAILED:", error);
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * Firestore ドキュメント保存
 */
export async function saveDocument(collectionName, docId, payload) {
  const firestore = initFirebase();
  
  console.log("FIRESTORE_SAVE_START", { collectionName, payload });

  if (!firestore) {
    console.warn("Firestore not initialized. Local cache only.");
    return false;
  }

  try {
    const targetId = docId || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
    await firestore.collection(collectionName).doc(targetId).set(payload, { merge: true });

    console.log("FIRESTORE_SAVE_SUCCESS", { collectionName, documentId: targetId });
    return true;
  } catch (error) {
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
    console.error("FIRESTORE_DELETE_ERROR", { collectionName, docId, code: error.code, message: error.message });
    throw error;
  }
}
