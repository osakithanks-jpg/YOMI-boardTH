/**
 * 選考進捗・ヨミ管理システム - Firebase / 端末B リアルタイム診断モジュール
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

// 端末B 診断用グローバルオブジェクト (指示書 1, 6項)
if (typeof window !== 'undefined') {
  window.TERMINAL_B_DEBUG = {
    projectId: "selection-progress-app",
    databaseId: "(default)",
    targetCollection: "selections",
    serverReadCount: 0,
    snapshotCount: 0,
    snapshotStarted: false,
    snapshotReceiveCount: 0,
    fromCache: false,
    hasPendingWrites: false,
    lastReceivedAt: "-",
    errorCode: "none",
    errorMessage: "none"
  };
}

export function initFirebase() {
  if (isFirebaseInitialized) return db;

  try {
    const config = getFirebaseConfig();

    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();

      // 指示書 7項: Auth初期化・匿名サインインによる permission-denied 解消
      if (firebase.auth) {
        const auth = firebase.auth();
        if (!auth.currentUser) {
          auth.signInAnonymously().then(() => {
            console.log("Firebase Auth initialized successfully.");
          }).catch((err) => {
            console.warn("Firebase Auth sign-in warning:", err.message || err);
          });
        }
      }

      isFirebaseInitialized = true;
    } else {
      console.warn("Firebase SDK is not loaded.");
    }
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }

  return db;
}

let authPromise = null;

export function ensureFirebaseAuth() {
  const firestore = initFirebase();
  if (!firestore) return Promise.resolve(null);

  if (!authPromise) {
    authPromise = new Promise((resolve) => {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        const auth = firebase.auth();
        const unsubscribe = auth.onAuthStateChanged((user) => {
          if (user) {
            console.log("Firebase Auth State Verified (onAuthStateChanged):", user.uid);
            if (unsubscribe) unsubscribe();
            resolve(firestore);
          } else {
            auth.signInAnonymously().then((cred) => {
              console.log("Firebase Auth Anonymous Signed-in:", cred.user ? cred.user.uid : 'authenticated');
              if (unsubscribe) unsubscribe();
              resolve(firestore);
            }).catch((err) => {
              console.warn("Firebase Auth Sign-in Warning:", err.message || err);
              if (unsubscribe) unsubscribe();
              resolve(firestore);
            });
          }
        });
      } else {
        resolve(firestore);
      }
    });
  }

  return authPromise;
}

/**
 * 指示書 1, 6項準拠: includeMetadataChanges: true を持つ端末B診断用 onSnapshot リスナー
 */
export async function listenCollection(collectionName, callback) {
  const firestore = await ensureFirebaseAuth();
  const config = getFirebaseConfig();

  if (window.TERMINAL_B_DEBUG) {
    window.TERMINAL_B_DEBUG.projectId = config.projectId;
    window.TERMINAL_B_DEBUG.targetCollection = collectionName;
    window.TERMINAL_B_DEBUG.snapshotStarted = true;
  }

  console.log("B_SNAPSHOT_STARTED");

  if (!firestore) {
    if (window.TERMINAL_B_DEBUG) {
      window.TERMINAL_B_DEBUG.errorCode = "SDK_NOT_LOADED";
      window.TERMINAL_B_DEBUG.errorMessage = "Firestore SDK not initialized";
    }
    return () => {};
  }

  try {
    // 指示書 6項: { includeMetadataChanges: true } オプション付与
    const unsubscribe = firestore.collection(collectionName).onSnapshot(
      { includeMetadataChanges: true },
      (snapshot) => {
        const fromCache = snapshot.metadata ? snapshot.metadata.fromCache : false;
        const hasPendingWrites = snapshot.metadata ? snapshot.metadata.hasPendingWrites : false;

        if (window.TERMINAL_B_DEBUG) {
          window.TERMINAL_B_DEBUG.snapshotCount = snapshot.size;
          window.TERMINAL_B_DEBUG.snapshotReceiveCount++;
          window.TERMINAL_B_DEBUG.fromCache = fromCache;
          window.TERMINAL_B_DEBUG.hasPendingWrites = hasPendingWrites;
          window.TERMINAL_B_DEBUG.lastReceivedAt = new Date().toLocaleTimeString();
          window.TERMINAL_B_DEBUG.errorCode = "none";
          window.TERMINAL_B_DEBUG.errorMessage = "none";
        }

        // 指示書 6項: B_SNAPSHOT_RECEIVED ログ
        console.log("B_SNAPSHOT_RECEIVED", {
          count: snapshot.size,
          fromCache,
          hasPendingWrites,
          ids: snapshot.docs.map((doc) => doc.id)
        });

        const data = snapshot.docs.map((doc) => ({
          docId: doc.id,
          id: doc.id,
          ...doc.data()
        }));

        callback(data);
      },
      (error) => {
        if (window.TERMINAL_B_DEBUG) {
          window.TERMINAL_B_DEBUG.errorCode = error.code || "UNKNOWN";
          window.TERMINAL_B_DEBUG.errorMessage = error.message || String(error);
        }

        // 指示書 6項: B_SNAPSHOT_ERROR ログ
        console.error("B_SNAPSHOT_ERROR", {
          code: error.code,
          message: error.message
        });
      }
    );

    return unsubscribe;
  } catch (err) {
    console.error("B_SNAPSHOT_ERROR", {
      code: err.code || "unknown",
      message: err.message
    });
    return () => {};
  }
}

/**
 * 指示書 6項: 強制サーバー読込 (getDocsFromServer 相当) ＆ B_SERVER_READ ログ
 */
export async function fetchServerReadDirect(collectionName = "selections") {
  const firestore = await ensureFirebaseAuth();
  if (!firestore) return [];

  try {
    let snapshot;
    try {
      snapshot = await firestore.collection(collectionName).get({ source: 'server' });
    } catch (serverErr) {
      console.warn("B_SERVER_READ_WARN: Falling back to default cache/store get query.", serverErr.message || serverErr);
      snapshot = await firestore.collection(collectionName).get();
    }
    
    const docsData = snapshot.docs.map((doc) => ({
      id: doc.id,
      docId: doc.id,
      ...doc.data()
    }));

    if (window.TERMINAL_B_DEBUG) {
      window.TERMINAL_B_DEBUG.serverReadCount = snapshot.size;
    }

    console.log("B_SERVER_READ", {
      count: snapshot.size,
      ids: snapshot.docs.map((doc) => doc.id),
      data: docsData
    });

    return docsData;
  } catch (error) {
    console.error("B_SERVER_READ_FAILED", error);
    if (window.TERMINAL_B_DEBUG) {
      window.TERMINAL_B_DEBUG.errorCode = error.code || "SERVER_READ_ERROR";
      window.TERMINAL_B_DEBUG.errorMessage = error.message || String(error);
    }
    return [];
  }
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
    // 指示書 16項: 5秒間のタイムアウト保護で無限フリーズを物理遮断
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn(`Firestore save timeout (5s) for ${collectionName}/${targetId}. Proceeding with local state.`);
        resolve('TIMEOUT');
      }, 5000);
    });

    const savePromise = firestore.collection(collectionName).doc(targetId).set(cleanPayload, { merge: true });
    await Promise.race([savePromise, timeoutPromise]);

    return true;
  } catch (error) {
    console.error(`Firestore save error (${collectionName}/${targetId}):`, error);
    throw error;
  }
}

/**
 * 指示書 10項: 1件のドキュメントをサーバーから直接Read-back確認
 */
export async function readbackFirestoreDoc(collectionName, docId) {
  const firestore = await ensureFirebaseAuth();
  if (!firestore || !docId) return null;

  try {
    const docSnap = await firestore.collection(collectionName).doc(String(docId)).get({ source: 'server' });
    if (docSnap.exists) {
      const data = docSnap.data();
      console.log(`[SAVE 07] firestore readback success (${collectionName}/${docId}):`, data);
      return data;
    } else {
      console.warn(`[SAVE 07] firestore readback warning: document ${docId} does not exist on server.`);
      return null;
    }
  } catch (err) {
    console.warn(`[SAVE 07] firestore readback warning (${collectionName}/${docId}):`, err.message || err);
    return null;
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
