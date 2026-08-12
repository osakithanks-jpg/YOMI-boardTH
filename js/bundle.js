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

function initFirebase() {
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

/**
 * 指示書 1, 6項準拠: includeMetadataChanges: true を持つ端末B診断用 onSnapshot リスナー
 */
function listenCollection(collectionName, callback) {
  const firestore = initFirebase();
  const config = getFirebaseConfig();

  if (window.TERMINAL_B_DEBUG) {
    window.TERMINAL_B_DEBUG.projectId = config.projectId;
    window.TERMINAL_B_DEBUG.targetCollection = collectionName;
    window.TERMINAL_B_DEBUG.snapshotStarted = true;
  }

  // 指示書 6項: ログ出力
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
async function fetchServerReadDirect(collectionName = "selections") {
  const firestore = initFirebase();
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
async function saveFirestoreDoc(collectionName, docId, payload) {
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
async function deleteFirestoreDoc(collectionName, docId) {
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


/**
 * 選考進捗・ヨミ管理システム - 定数定義 (ホワイトボード5区分化 ＆ 本日のRA対応表示対応)
 */

const ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member'
};

const CONSULTANT_ROLES = {
  CA: 'CA',
  RA: 'RA',
  ADMIN: 'ADMIN'
};

// 選考フェーズ (マスター定義)
const PHASES = [
  '推薦準備',
  '書類選考',
  '一次面接',
  '二次面接',
  '三次面接',
  '最終面接',
  'オファー面談・条件提示',
  '内定',
  '内定承諾',
  '入社予定',
  '内定辞退',
  '選考終了'
];

// ホワイトボード専用 5区分フェーズグループ定義 (指示書 5, 6, 7項)
const WHITEBOARD_5PHASES = [
  { groupCode: 'group_5', order: 50, label: '内定承諾', phases: ['内定承諾', '承諾', '入社予定', '入社日確定', '入社手続き中', '内定承諾後'] },
  { groupCode: 'group_4', order: 40, label: '内定', phases: ['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整中', '内定回答待ち', '候補者回答待ち', 'オファー面談調整中'] },
  { groupCode: 'group_3', order: 30, label: '最終・二次', phases: ['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接', '二次面接以降', '最終面接前面談', '最終'] },
  { groupCode: 'group_2', order: 20, label: '一次', phases: ['一次面接', '一次選考', '一次面談', 'カジュアル面談', '一次面接日程調整', '一次面接結果待ち', '一次'] },
  { groupCode: 'group_1', order: 10, label: '書類選考', phases: ['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち', '企業推薦前確認', '書類'] }
];

// 互換性のための定義
const KANBAN_VERTICAL_LEVELS = WHITEBOARD_5PHASES.map(g => ({
  levelId: g.groupCode,
  order: g.order,
  label: g.label,
  phases: g.phases
}));

// 緊急度区分 (指示書 17項)
const URGENCY_LEVELS = {
  EXPIRED: { code: 'expired', label: '期限超過', borderClass: 'border-l-4 border-l-rose-600 border-rose-300', badgeClass: 'bg-rose-600 text-white font-black animate-pulse' },
  TODAY: { code: 'today', label: '本日対応', borderClass: 'border-l-4 border-l-orange-500 border-orange-300', badgeClass: 'bg-orange-500 text-white font-extrabold' },
  WAITING_REPLY: { code: 'waiting_reply', label: '企業回答待ち', borderClass: 'border-l-4 border-l-sky-400 border-slate-200', badgeClass: 'bg-sky-100 text-sky-800 border border-sky-300 font-bold' },
  CA_CHECK: { code: 'ca_check', label: 'CA確認待ち', borderClass: 'border-l-4 border-l-purple-400 border-slate-200', badgeClass: 'bg-purple-100 text-purple-800 border border-purple-300 font-bold' },
  WITHIN_3DAYS: { code: 'within_3days', label: '3日以内', borderClass: 'border-l-4 border-l-amber-400 border-amber-200', badgeClass: 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' },
  NONE: { code: 'none', label: '対応不要', borderClass: 'border-l-2 border-l-slate-300 border-slate-200', badgeClass: 'bg-slate-100 text-slate-600 font-normal' },
  DECLINED: { code: 'declined', label: '内定辞退', borderClass: 'border-l-4 border-l-slate-400 border-slate-300 bg-slate-200/80', badgeClass: 'bg-slate-500 text-white font-extrabold' }
};

// 対応先 (指示書 16項)
const NEXT_ACTION_TARGETS = [
  { code: 'company', label: '企業', badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { code: 'ca', label: 'CA', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200' },
  { code: 'internal', label: '社内', badgeClass: 'bg-slate-100 text-slate-800 border-slate-200' },
  { code: 'none', label: '対応不要', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' }
];

// 選考終了理由
const END_REASONS = [
  '書類見送り',
  '一次面接見送り',
  '二次面接見送り',
  '最終面接見送り',
  '候補者辞退',
  '内定辞退',
  '他社決定',
  '求人クローズ',
  '企業都合終了',
  'その他'
];

// エントリー経路
const ENTRY_SOURCES = [
  { code: 'BIZREACH', label: 'ビズ' },
  { code: 'MIDDLE', label: 'ミドル' },
  { code: 'AMBI', label: 'AMBI' },
  { code: 'RDS', label: 'RDS' },
  { code: 'DB', label: 'DB' },
  { code: 'IX', label: 'IX' },
  { code: 'MAPS', label: 'Maps' },
  { code: 'INDEED', label: 'Indeed' },
  { code: 'PASS_UP', label: 'パスアップ' },
  { code: 'OTHER', label: 'その他' }
];

const PROGRESS_STATUSES = [
  '未対応',
  '推薦済み・回答待ち',
  '日程調整中',
  '日程確定',
  '実施済み・結果待ち',
  '条件提示中',
  '承諾完了',
  '不通過',
  '候補者辞退',
  '企業都合終了',
  '完了'
];

const YOMI_OPTIONS = [
  { value: 1.0, label: '100% (確定)' },
  { value: 0.75, label: '75% (極高)' },
  { value: 0.5, label: '50% (五分)' },
  { value: 0.25, label: '25% (チャレンジ)' },
  { value: 0, label: '0% (見込みなし/終了)' }
];

const COMPANY_RANKS = ['SS', 'S', 'A', 'B'];

const COMPANY_RANK_BADGES = {
  'SS': { label: 'ランク: SS (最重要)', badgeClass: 'bg-rose-100 text-rose-900 border-rose-300 font-black' },
  'S':  { label: 'ランク: S (重点)', badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold' },
  'A':  { label: 'ランク: A (通常)', badgeClass: 'bg-blue-100 text-blue-900 border-blue-300 font-bold' },
  'B':  { label: 'ランク: B (経過観察)', badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 font-semibold' }
};

const COMPANY_ACTION_TYPES = [
  '推薦後の回答確認',
  '面接調整の依頼・確認',
  '面接結果の確認',
  '内定条件・オファー回答の確認',
  '選考進捗の一括確認',
  'その他'
];

const COMPANY_ACTION_STATUSES = [
  '未対応',
  '連絡済み',
  '回答待ち',
  '催促中',
  '完了'
];

const JOB_STATUSES = [
  '募集中',
  '一時停止',
  '募集終了'
];

const INITIAL_CONSULTANTS = [
  { consultantId: 'c1', name: '佐藤 健太', email: 'sato@thanks-partners.com', role: 'admin', roleType: 'ADMIN', status: 'active', displayOrder: 1, isArchived: false, isDemo: true },
  { consultantId: 'c2', name: '田中 美咲', email: 'tanaka@thanks-partners.com', role: 'member', roleType: 'CA', status: 'active', displayOrder: 2, isArchived: false, isDemo: true },
  { consultantId: 'c3', name: '鈴木 拓也', email: 'suzuki@thanks-partners.com', role: 'member', roleType: 'RA', status: 'active', displayOrder: 3, isArchived: false, isDemo: true },
  { consultantId: 'c4', name: '高橋 優花', email: 'takahashi@thanks-partners.com', role: 'member', roleType: 'CA', status: 'active', displayOrder: 4, isArchived: false, isDemo: true }
];

const INITIAL_COMPANIES = [
  { companyId: 'comp1', name: '株式会社テクノロジーパートナーズ', rank: 'SS', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 3, contactPerson: '山田 太郎', contactName: '山田 太郎', contactEmail: 'yamada@tech-partners.co.jp', isArchived: false, isDemo: true, createdBySeed: true },
  { companyId: 'comp2', name: 'グローバルソリューションズ株式会社', rank: 'S', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 7, contactPerson: '佐藤 二郎', contactName: '佐藤 二郎', contactEmail: 'sato@global-sol.co.jp', isArchived: false, isDemo: true, createdBySeed: true },
  { companyId: 'comp3', name: 'イノベーション・システムズ', rank: 'A', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 14, contactPerson: '高橋 三郎', contactName: '高橋 三郎', contactEmail: '', isArchived: false, isDemo: true, createdBySeed: true }
];

const INITIAL_JOBS = [
  { jobId: 'job1', companyId: 'comp1', companyName: '株式会社テクノロジーパートナーズ', title: 'シニアフロントエンドエンジニア', location: '東京都千代田区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job2', companyId: 'comp1', companyName: '株式会社テクノロジーパートナーズ', title: 'バックエンドエンジニア (Go/Python)', location: '東京都千代田区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job3', companyId: 'comp2', companyName: 'グローバルソリューションズ株式会社', title: 'ITコンサルタント', location: '東京都港区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job4', companyId: 'comp3', companyName: 'イノベーション・システムズ', title: 'インフラエンジニア (AWS/K8s)', location: 'リモート可', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true }
];

const INITIAL_CANDIDATES = [
  { candidateId: 'cand1', name: '山田 太郎', kana: 'ヤマダ タロウ', caId: 'c2', caConsultantId: 'c2', caName: '田中 美咲', activityStatus: '選考中', entrySource: 'BIZREACH', entrySourceDetail: '', internalManagementNumber: 'CD-2026-001', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand2', name: '佐藤 花子', kana: 'サトウ ハナコ', caId: 'c2', caConsultantId: 'c2', caName: '田中 美咲', activityStatus: '選考中', entrySource: 'PASS_UP', entrySourceDetail: '若山さんスカウト', internalManagementNumber: 'CD-2026-002', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand3', name: '鈴木 一郎', kana: 'スズキ イチロウ', caId: 'c4', caConsultantId: 'c4', caName: '高橋 優花', activityStatus: '選考中', entrySource: 'AMBI', entrySourceDetail: '', internalManagementNumber: 'CD-2026-003', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand4', name: '高橋 健二', kana: 'タカハシ ケンジ', caId: 'c4', caConsultantId: 'c4', caName: '高橋 優花', activityStatus: '選考中', entrySource: 'RDS', entrySourceDetail: '', internalManagementNumber: 'CD-2026-004', isArchived: false, isDemo: true, createdBySeed: true }
];

const INITIAL_SELECTIONS = [
  {
    selectionId: 'sel1',
    candidateId: 'cand1',
    candidateName: '山田 太郎',
    companyId: 'comp1',
    companyName: '株式会社テクノロジーパートナーズ',
    jobId: 'job1',
    jobName: 'シニアフロントエンドエンジニア',
    caId: 'c2',
    caConsultantId: 'c2',
    caName: '田中 美咲',
    raId: 'c3',
    raConsultantId: 'c3',
    raName: '鈴木 拓也',
    entrySource: 'BIZREACH',
    entrySourceDetail: '',
    recommendationDate: '2026-07-01',
    phase: '一次面接',
    progressStatus: '実施済み・結果待ち',
    phaseUpdatedAt: '2026-07-20T10:00:00Z',
    nextScheduleDate: '2026-07-24',
    expectedCompletionMonth: '2026-08',
    yomi: 0.50,
    yomiReason: '一次面接の手応え良好',
    nextAction: '企業へ一次面接結果を確認',
    nextActionTarget: '企業',
    actionDeadline: '2026-07-26',
    companyActionType: '面接結果の確認',
    companyConfirmationItem: '一次面接結果のご確認をお願いいたします。',
    companyActionStatus: '未対応',
    internalMemo: '志望度高く、他社選考なし。',
    companySharedComment: '候補者様も結果を楽しみにしております。',
    isArchived: false,
    isDemo: true,
    createdBySeed: true
  },
  {
    selectionId: 'sel2',
    candidateId: 'cand2',
    candidateName: '佐藤 花子',
    companyId: 'comp2',
    companyName: 'グローバルソリューションズ株式会社',
    jobId: 'job3',
    jobName: 'ITコンサルタント',
    caId: 'c2',
    caConsultantId: 'c2',
    caName: '田中 美咲',
    raId: 'c3',
    raConsultantId: 'c3',
    raName: '鈴木 拓也',
    entrySource: 'PASS_UP',
    entrySourceDetail: '若山さんスカウト',
    recommendationDate: '2026-07-05',
    phase: '最終面接',
    progressStatus: '日程確定',
    phaseUpdatedAt: '2026-07-22T14:30:00Z',
    nextScheduleDate: '2026-07-29',
    expectedCompletionMonth: '2026-08',
    yomi: 0.75,
    yomiReason: '最終面接調整完了',
    nextAction: '企業へ選考進捗・評価観点を確認',
    nextActionTarget: '企業',
    actionDeadline: '2026-07-28',
    companyActionType: '選考進捗の一括確認',
    companyConfirmationItem: '最終面接時の評価観点について確認中',
    companyActionStatus: '回答待ち',
    internalMemo: '競合A社と最終面接重複あり。',
    companySharedComment: '面接設定ありがとうございます。',
    isArchived: false,
    isDemo: true,
    createdBySeed: true
  }
];

const INITIAL_TARGETS = [];
const INITIAL_Q_TARGETS = [
  { id: 'qt_c2_2025_Q4', consultantId: 'c2', fiscalYear: 2025, quarter: 'Q4', targetCount: 6, isDemo: true, createdBySeed: true },
  { id: 'qt_c4_2025_Q4', consultantId: 'c4', fiscalYear: 2025, quarter: 'Q4', targetCount: 5, isDemo: true, createdBySeed: true }
];

const INITIAL_HISTORIES = [];
const INITIAL_EMAIL_TEMPLATES = [
  { templateId: 't1', name: '標準・結果待ち催促', subject: '【選考進捗のご確認】貴社選考中候補者様の状況につきまして（サンクスパートナーズ）', body: 'いつも大変お世話になっております。', isDemo: true, createdBySeed: true }
];

const INITIAL_COMPANY_COMMUNICATIONS = [];

/**
 * 既存データの互換性読み替えルール
 */
function normalizeSelectionPhaseAndReason(selection) {
  let phase = selection.phase || '書類選考';
  let progressStatus = selection.progressStatus || '未対応';
  let endReason = selection.endReason || selection.endReasonDetail || '';

  if (phase === '内定後辞退' || progressStatus === '候補者辞退' && (phase === '内定' || phase === '内定承諾' || phase === 'オファー面談・条件提示')) {
    phase = '内定辞退';
    endReason = endReason || '内定辞退';
  } else if (progressStatus === '不通過' || phase === '書類不通過' || phase === '面接不通過') {
    if (phase === '書類選考' || phase === '書類不通過') {
      phase = '選考終了';
      endReason = endReason || '書類見送り';
    } else {
      phase = '選考終了';
      endReason = endReason || '面接見送り';
    }
  }

  return { phase, progressStatus, endReason };
}


/**
 * 選考進捗・ヨミ管理システム - データストア (マスタ編集・2段階削除・関連データ保護・監査ログ対応)
 */





const STORAGE_KEYS = {
  CONSULTANTS: 'selection_app_consultants',
  COMPANIES: 'selection_app_companies',
  JOBS: 'selection_app_jobs',
  CANDIDATES: 'selection_app_candidates',
  SELECTIONS: 'selection_app_selections',
  TARGETS: 'selection_app_targets',
  Q_TARGETS: 'selection_app_q_targets',
  Q_TARGET_HISTORIES: 'selection_app_q_target_histories',
  HISTORIES: 'selection_app_histories',
  EMAIL_TEMPLATES: 'selection_app_email_templates',
  COMPANY_COMMUNICATIONS: 'selection_app_company_communications',
  COMPANY_SUBMISSIONS: 'selection_app_company_submissions',
  COMPANY_SUBMISSION_TEMPLATES: 'selection_app_company_submission_templates',
  MASTER_AUDIT_LOGS: 'selection_app_master_audit_logs',
  CURRENT_CONSULTANT: 'selection_app_current_consultant',
  SIMULATED_ROLE: 'selection_app_simulated_role',
  IS_INITIALIZED: 'selection_app_initialized'
};

class Store {
  constructor() {
    this.listeners = [];
    this.isLoading = true; // 読み込み完了前の表示制御
    this.firestoreSyncedCollections = new Set();
    
    // 指示書準拠: 共通業務データの唯一の正本はメモリ state (this.data)
    this.data = {
      selections: [],
      companies: [],
      jobs: [],
      candidates: [],
      consultants: INITIAL_CONSULTANTS,
      qTargets: [],
      histories: [],
      companyCommunications: []
    };

    this.initFirestoreSync();
  }

  initFirestoreSync() {
    // 指示書 6項: 強制確認としてのサーバー直接取得
    fetchServerReadDirect('selections');

    // 指示書準拠: onSnapshot による全共通コレクションのリアルタイムストリーム監視
    const collectionsToSync = [
      { name: 'selections', field: 'selections' },
      { name: 'companies', field: 'companies' },
      { name: 'jobs', field: 'jobs' },
      { name: 'candidates', field: 'candidates' },
      { name: 'consultants', field: 'consultants' },
      { name: 'qTargets', field: 'qTargets' },
      { name: 'histories', field: 'histories' },
      { name: 'companyCommunications', field: 'companyCommunications' }
    ];

    collectionsToSync.forEach(({ name, field }) => {
      listenCollection(name, (items) => {
        const validItems = Array.isArray(items) ? items : [];

        // 指示書準拠: onSnapshot からの全件データを直接 state へストリーム反映
        this.data[field] = validItems;
        this.firestoreSyncedCollections.add(name);
        
        // 初回読み込み完了判定
        if (this.firestoreSyncedCollections.size >= 4) {
          this.isLoading = false;
        }

        this.notify();
      });
    });
  }

  getItem(key) {
    // 指示書 2項: 業務データの表示元・正本として localStorage を使用することを完全禁止
    const keyToDataField = {
      [STORAGE_KEYS.SELECTIONS]: 'selections',
      [STORAGE_KEYS.COMPANIES]: 'companies',
      [STORAGE_KEYS.JOBS]: 'jobs',
      [STORAGE_KEYS.CANDIDATES]: 'candidates',
      [STORAGE_KEYS.CONSULTANTS]: 'consultants',
      [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
      [STORAGE_KEYS.HISTORIES]: 'histories',
      [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
    };

    const dataField = keyToDataField[key];
    if (dataField) {
      // 業務データはメモリ state (this.data) からのみ返却
      return this.data[dataField] || [];
    }

    // UI設定（現在選択コンサルタント・ロール設定など）のみ localStorage から取得可
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  ensureBackwardCompatibility() {
    const consultants = this.getItem(STORAGE_KEYS.CONSULTANTS);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    let consUpdated = false;
    consultants.forEach(c => {
      if (!c.roleType) {
        c.roleType = c.role === 'admin' ? 'ADMIN' : (c.name.includes('鈴木') ? 'RA' : 'CA');
        consUpdated = true;
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        if (c.roleType === 'ADMIN') {
          c.roles = ['ADMIN', 'CA', 'RA'];
        } else if (c.roleType === 'RA') {
          c.roles = ['RA'];
        } else {
          c.roles = ['CA'];
        }
        consUpdated = true;
      }
      if (c.status === undefined) {
        c.status = 'active';
        consUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        consUpdated = true;
      }
    });
    if (consUpdated) this.setItem(STORAGE_KEYS.CONSULTANTS, consultants);

    const demoCompanyIds = new Set(['comp1', 'comp2', 'comp3']);
    const demoJobIds = new Set(['job1', 'job2', 'job3', 'job4']);
    const demoCandIds = new Set(['cand1', 'cand2', 'cand3', 'cand4']);
    const demoSelIds = new Set(['sel1', 'sel2']);

    let compUpdated = false;
    const mapRank = (r) => {
      if (r === '最重要' || r === 'SS') return 'SS';
      if (r === '重点' || r === 'S') return 'S';
      if (r === '通常' || r === 'A') return 'A';
      if (r === '経過観察' || r === 'B') return 'B';
      return 'B';
    };

    companies.forEach(c => {
      if (c.isDemo === undefined && (demoCompanyIds.has(c.companyId) || c.createdBySeed)) {
        c.isDemo = true;
        c.createdBySeed = true;
        compUpdated = true;
      }
      const newRank = mapRank(c.rank);
      if (c.rank !== newRank) {
        c.rank = newRank;
        compUpdated = true;
      }
      if (!c.contactName && c.contactPerson) {
        c.contactName = c.contactPerson;
        compUpdated = true;
      }
      if (!c.contactPerson && c.contactName) {
        c.contactPerson = c.contactName;
        compUpdated = true;
      }
      if (!c.primaryRaId) {
        c.primaryRaId = c.raConsultantId || 'c3';
        c.primaryRaName = consultantsMap.get(c.primaryRaId)?.name || '鈴木 拓也';
        compUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        compUpdated = true;
      }
    });
    if (compUpdated) this.setItem(STORAGE_KEYS.COMPANIES, companies);

    let jobsUpdated = false;
    jobs.forEach(j => {
      if (j.isDemo === undefined && (demoJobIds.has(j.jobId) || j.createdBySeed)) {
        j.isDemo = true;
        j.createdBySeed = true;
        jobsUpdated = true;
      }
      if (!j.raId) {
        j.raId = j.raConsultantId || 'c3';
        jobsUpdated = true;
      }
      if (j.location === undefined) {
        j.location = '';
        jobsUpdated = true;
      }
      if (j.isArchived === undefined) {
        j.isArchived = false;
        jobsUpdated = true;
      }
    });
    if (jobsUpdated) this.setItem(STORAGE_KEYS.JOBS, jobs);

    let candUpdated = false;
    candidates.forEach(c => {
      if (c.isDemo === undefined && (demoCandIds.has(c.candidateId) || c.createdBySeed)) {
        c.isDemo = true;
        c.createdBySeed = true;
        candUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        candUpdated = true;
      }
    });
    let selUpdated = false;
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    selections.forEach(s => {
      if (s.isDemo === undefined && (demoSelIds.has(s.selectionId) || s.createdBySeed)) {
        s.isDemo = true;
        s.createdBySeed = true;
        selUpdated = true;
      }
      const cand = candidatesMap.get(s.candidateId);
      const comp = companiesMap.get(s.companyId);
      const job = jobsMap.get(s.jobId);

      if (s.entrySource === undefined) {
        s.entrySource = 'UNSET';
        s.entrySourceDetail = '';
        selUpdated = true;
      }
      if (!s.caId) {
        s.caId = s.caConsultantId || (cand ? cand.caId : 'c2');
        s.caName = consultantsMap.get(s.caId)?.name || s.caName || '-';
        selUpdated = true;
      }
      if (!s.raId) {
        s.raId = s.raConsultantId || (job ? job.raId : (comp ? comp.primaryRaId : 'c3'));
        s.raName = consultantsMap.get(s.raId)?.name || s.raName || '-';
        selUpdated = true;
      }
      if (s.isArchived === undefined) {
        s.isArchived = false;
        selUpdated = true;
      }
    });
    if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  getItem(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error(`Error reading ${key} from localStorage`, e);
      return [];
    }
  }

  setItem(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));

      // キーから Firestore コレクション名へのマッピング (指示書 4, 7項)
      const keyToCollection = {
        [STORAGE_KEYS.SELECTIONS]: 'selections',
        [STORAGE_KEYS.COMPANIES]: 'companies',
        [STORAGE_KEYS.JOBS]: 'jobs',
        [STORAGE_KEYS.CANDIDATES]: 'candidates',
        [STORAGE_KEYS.CONSULTANTS]: 'consultants',
        [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
        [STORAGE_KEYS.HISTORIES]: 'histories',
        [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
      };

      const collectionName = keyToCollection[key];
      if (collectionName && Array.isArray(data)) {
        // Firestore ドキュメントの一括保存 (IDをキーとしてドキュメント化)
        data.forEach(item => {
          const docId = item.selectionId || item.companyId || item.jobId || item.candidateId || item.consultantId || item.id || item.historyId;
          if (docId) {
            saveDocument(collectionName, String(docId), item).catch(err => {
              console.warn(`Background Firestore save failed for ${collectionName}/${docId}:`, err);
            });
          }
        });
      }

      this.notify();
    } catch (e) {
      console.error(`Error writing ${key} to localStorage/Firestore`, e);
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(l => l());
  }

  setItem(key, data) {
    const keyToCollection = {
      [STORAGE_KEYS.SELECTIONS]: 'selections',
      [STORAGE_KEYS.COMPANIES]: 'companies',
      [STORAGE_KEYS.JOBS]: 'jobs',
      [STORAGE_KEYS.CANDIDATES]: 'candidates',
      [STORAGE_KEYS.CONSULTANTS]: 'consultants',
      [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
      [STORAGE_KEYS.HISTORIES]: 'histories',
      [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
    };

    const collectionName = keyToCollection[key];
    if (collectionName && Array.isArray(data)) {
      data.forEach(item => {
        const docId = item.selectionId || item.companyId || item.jobId || item.candidateId || item.consultantId || item.targetId || item.id || item.historyId;
        if (docId) {
          saveFirestoreDoc(collectionName, String(docId), item).catch(err => {
            console.error(`Firestore save failed for ${collectionName}/${docId}:`, err);
          });
        }
      });
    }

    const keyToField = {
      [STORAGE_KEYS.SELECTIONS]: 'selections',
      [STORAGE_KEYS.COMPANIES]: 'companies',
      [STORAGE_KEYS.JOBS]: 'jobs',
      [STORAGE_KEYS.CANDIDATES]: 'candidates',
      [STORAGE_KEYS.CONSULTANTS]: 'consultants',
      [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
      [STORAGE_KEYS.HISTORIES]: 'histories',
      [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
    };
    if (keyToField[key]) {
      this.data[keyToField[key]] = data;
    }

    this.notify();
  }

  // --- 操作アカウント & 権限設定 ---
  getCurrentConsultant() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_CONSULTANT);
      return raw ? JSON.parse(raw) : INITIAL_CONSULTANTS[0];
    } catch (e) {
      return INITIAL_CONSULTANTS[0];
    }
  }

  setCurrentConsultant(consultantId) {
    const consultants = this.getConsultants(true);
    const target = consultants.find(c => c.consultantId === consultantId);
    if (target) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_CONSULTANT, JSON.stringify(target));
      const role = (target.roleType === 'ADMIN' || target.role === 'admin') ? 'admin' : 'member';
      localStorage.setItem(STORAGE_KEYS.SIMULATED_ROLE, role);
      this.notify();
    }
  }

  setCurrentUser(consultantId) {
    this.setCurrentConsultant(consultantId);
  }

  getCurrentRole() {
    try {
      const simRole = localStorage.getItem(STORAGE_KEYS.SIMULATED_ROLE);
      if (simRole) return simRole;
      const current = this.getCurrentConsultant();
      return (current.roleType === 'ADMIN' || current.role === 'admin') ? 'admin' : 'member';
    } catch (e) {
      return 'admin';
    }
  }

  setCurrentRole(role) {
    try {
      localStorage.setItem(STORAGE_KEYS.SIMULATED_ROLE, role);
      this.notify();
    } catch (e) {}
  }

  isAdmin() {
    return this.getCurrentRole() === 'admin';
  }

  resetToDefaults() {
    localStorage.clear();
    sessionStorage.clear();
    this.initData();
    this.notify();
  }

  checkConsultantEmailDuplicate(email, excludeConsultantId = null) {
    const info = this.checkConsultantEmailDuplicateInfo(email, excludeConsultantId);
    return info.isDuplicate;
  }

  checkConsultantEmailDuplicateInfo(email, excludeConsultantId = null, inputName = '') {
    if (!email) return { isDuplicate: false, existingConsultant: null, isSameName: false };
    const normalized = email.trim().toLowerCase();
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);

    const existing = list.find(c => {
      if (excludeConsultantId && c.consultantId === excludeConsultantId) return false;
      return (c.email || '').trim().toLowerCase() === normalized;
    });

    if (!existing) {
      return { isDuplicate: false, existingConsultant: null, isSameName: false };
    }

    const trimmedInputName = inputName.trim().replace(/\s+/g, '');
    const trimmedExistingName = (existing.name || '').trim().replace(/\s+/g, '');
    const isSameName = !trimmedInputName || trimmedInputName === trimmedExistingName;

    return {
      isDuplicate: true,
      existingConsultant: existing,
      isSameName
    };
  }

  checkConsultantRoleInUse(consultantId, roleTypeToRemove) {
    if (!consultantId || !roleTypeToRemove) return 0;
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(s => !s.isArchived);

    if (roleTypeToRemove === 'CA') {
      return selections.filter(s => s.caId === consultantId || s.caConsultantId === consultantId).length;
    }
    if (roleTypeToRemove === 'RA') {
      return selections.filter(s => s.raId === consultantId || s.raConsultantId === consultantId).length;
    }
    return 0;
  }

  // --- Q目標管理メソッド (重要機能の完全復元) ---
  getQTargets(fiscalYear = 2025, quarter = 'Q4') {
    const list = this.getItem(STORAGE_KEYS.Q_TARGETS);
    if (quarter === 'ALL') {
      return list.filter(t => t.fiscalYear === parseInt(fiscalYear, 10));
    }
    return list.filter(t => t.fiscalYear === parseInt(fiscalYear, 10) && t.quarter === quarter);
  }

  saveQTarget(targetData) {
    const list = this.getItem(STORAGE_KEYS.Q_TARGETS);
    const histories = this.getItem(STORAGE_KEYS.Q_TARGET_HISTORIES);
    const fy = parseInt(targetData.fiscalYear, 10);
    const q = targetData.quarter;
    const cId = targetData.consultantId;

    const existingIdx = list.findIndex(t => t.consultantId === cId && t.fiscalYear === fy && t.quarter === q);
    const prevVal = existingIdx >= 0 ? list[existingIdx].targetCount : 0;
    const newVal = Number(targetData.targetCount || 0);

    const user = this.getCurrentConsultant();
    const newRecord = {
      id: `qt_${cId}_${fy}_${q}`,
      consultantId: cId,
      fiscalYear: fy,
      quarter: q,
      targetCount: newVal,
      notes: targetData.notes || '',
      updatedAt: new Date().toISOString(),
      updatedBy: user.name
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...newRecord };
    } else {
      list.push(newRecord);
    }
    this.setItem(STORAGE_KEYS.Q_TARGETS, list);

    if (prevVal !== newVal) {
      const historyItem = {
        id: `qth_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        consultantId: cId,
        consultantName: targetData.consultantName || cId,
        fiscalYear: fy,
        quarter: q,
        previousTarget: prevVal,
        newTarget: newVal,
        changedAt: new Date().toISOString(),
        changedBy: user.name,
        notes: targetData.notes || ''
      };
      histories.push(historyItem);
      this.setItem(STORAGE_KEYS.Q_TARGET_HISTORIES, histories);
    }
  }

  // --- 企業別提出テンプレート ---
  getCompanySubmissionTemplate(companyId) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES);
    return list.find(t => t.companyId === companyId) || null;
  }

  saveCompanySubmissionTemplate(templateData) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES);
    const idx = list.findIndex(t => t.companyId === templateData.companyId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...templateData, updatedAt: new Date().toISOString() };
    } else {
      templateData.createdAt = new Date().toISOString();
      list.push(templateData);
    }
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES, list);
  }

  // --- 監査ログ機能 (指示書 14項) ---
  recordMasterAuditLog(actionType, masterType, targetId, targetName, previousValue = null, newValue = null, reason = '') {
    const logs = this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
    const user = this.getCurrentConsultant();

    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      actionType, // CREATE | UPDATE | ARCHIVE | RESTORE | DELETE
      masterType, // candidate | company | job | consultant
      targetId,
      targetName,
      previousValue,
      newValue,
      reason,
      performedAt: new Date().toISOString(),
      performedBy: user.consultantId,
      performedByName: user.name
    };

    logs.push(logEntry);
    this.setItem(STORAGE_KEYS.MASTER_AUDIT_LOGS, logs);
  }

  getMasterAuditLogs() {
    return this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS).sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));
  }

  // --- 関連データカウント機能 (完全削除ブロック用) (指示書 7, 8, 9, 10項) ---
  getRelatedDataCounts(masterType, targetId) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const comms = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    const subs = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS);

    if (masterType === 'candidate') {
      const activeSelections = selections.filter(s => s.candidateId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.candidateId === targetId);
      return {
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        hasRelatedData: totalSelections.length > 0
      };
    }

    if (masterType === 'company') {
      const activeJobs = jobs.filter(j => j.companyId === targetId && !j.isArchived);
      const totalJobs = jobs.filter(j => j.companyId === targetId);
      const activeSelections = selections.filter(s => s.companyId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.companyId === targetId);
      const companyComms = comms.filter(c => c.companyId === targetId);
      const companySubs = subs.filter(s => s.companyId === targetId);

      const hasRelated = totalJobs.length > 0 || totalSelections.length > 0 || companyComms.length > 0 || companySubs.length > 0;
      return {
        jobCount: activeJobs.length,
        totalJobCount: totalJobs.length,
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        commCount: companyComms.length,
        subCount: companySubs.length,
        hasRelatedData: hasRelated
      };
    }

    if (masterType === 'job') {
      const activeSelections = selections.filter(s => s.jobId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.jobId === targetId);
      return {
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        hasRelatedData: totalSelections.length > 0
      };
    }

    if (masterType === 'consultant') {
      const caCandidates = candidates.filter(c => (c.caId === targetId || c.caConsultantId === targetId) && !c.isArchived);
      const raCompanies = companies.filter(c => (c.primaryRaId === targetId || c.raConsultantId === targetId) && !c.isArchived);
      const raJobs = jobs.filter(j => (j.raId === targetId || j.raConsultantId === targetId) && !j.isArchived);
      const consultantSelections = selections.filter(s => (s.caId === targetId || s.raId === targetId || s.caConsultantId === targetId || s.raConsultantId === targetId) && !s.isArchived);
      const consultantSubs = subs.filter(s => s.submittedBy === targetId);
      const consultantTargets = qTargets.filter(t => t.consultantId === targetId && t.targetCount > 0);

      const hasRelated = caCandidates.length > 0 || raCompanies.length > 0 || raJobs.length > 0 || consultantSelections.length > 0 || consultantSubs.length > 0;
      return {
        caCandidateCount: caCandidates.length,
        raCompanyCount: raCompanies.length,
        raJobCount: raJobs.length,
        selectionCount: consultantSelections.length,
        subCount: consultantSubs.length,
        targetCount: consultantTargets.length,
        hasRelatedData: hasRelated
      };
    }

    return { hasRelatedData: false };
  }

  // --- コンサル担当一括引き継ぎ (指示書 11項) ---
  reassignConsultantResponsibilities(fromConsultantId, toConsultantId) {
    if (!fromConsultantId || !toConsultantId || fromConsultantId === toConsultantId) return;

    const consultants = this.getConsultants(true);
    const toCons = consultants.find(c => c.consultantId === toConsultantId);
    if (!toCons) return;

    const user = this.getCurrentConsultant();

    // 1. 担当候補者引き継ぎ
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    let candCount = 0;
    candidates.forEach(c => {
      if (c.caId === fromConsultantId || c.caConsultantId === fromConsultantId) {
        c.caId = toConsultantId;
        c.caConsultantId = toConsultantId;
        c.caName = toCons.name;
        c.updatedAt = new Date().toISOString();
        c.updatedBy = user.name;
        candCount++;
      }
    });
    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);

    // 2. 担当企業引き継ぎ
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    let compCount = 0;
    companies.forEach(c => {
      if (c.primaryRaId === fromConsultantId || c.raConsultantId === fromConsultantId) {
        c.primaryRaId = toConsultantId;
        c.raConsultantId = toConsultantId;
        c.primaryRaName = toCons.name;
        c.updatedAt = new Date().toISOString();
        c.updatedBy = user.name;
        compCount++;
      }
    });
    this.setItem(STORAGE_KEYS.COMPANIES, companies);

    // 3. 担当求人引き継ぎ
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    let jobCount = 0;
    jobs.forEach(j => {
      if (j.raId === fromConsultantId || j.raConsultantId === fromConsultantId) {
        j.raId = toConsultantId;
        j.raConsultantId = toConsultantId;
        j.raName = toCons.name;
        j.updatedAt = new Date().toISOString();
        jobCount++;
      }
    });
    this.setItem(STORAGE_KEYS.JOBS, jobs);

    // 4. 進行中選考案件引き継ぎ
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    let selCount = 0;
    selections.forEach(s => {
      if (!s.isArchived && s.phase !== '選考終了') {
        if (s.caId === fromConsultantId || s.caConsultantId === fromConsultantId) {
          s.caId = toConsultantId;
          s.caConsultantId = toConsultantId;
          s.caName = toCons.name;
          s.updatedAt = new Date().toISOString();
          selCount++;
        }
        if (s.raId === fromConsultantId || s.raConsultantId === fromConsultantId) {
          s.raId = toConsultantId;
          s.raConsultantId = toConsultantId;
          s.raName = toCons.name;
          s.updatedAt = new Date().toISOString();
          selCount++;
        }
      }
    });
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);

    this.recordMasterAuditLog('UPDATE', 'consultant', fromConsultantId, '担当引き継ぎ', null, `引き継ぎ先: ${toCons.name}`, `候補者:${candCount}件, 企業:${compCount}件, 求人:${jobCount}件, 案件:${selCount}件を一括変更`);
  }

  // --- 2段階削除: 通常アーカイブ (指示書 3項) ---
  archiveMasterItem(masterType, targetId, reason = '') {
    const user = this.getCurrentConsultant();

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const idx = list.findIndex(c => c.candidateId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.CANDIDATES, list);
        this.recordMasterAuditLog('ARCHIVE', 'candidate', targetId, item.name, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const idx = list.findIndex(c => c.companyId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.COMPANIES, list);
        this.recordMasterAuditLog('ARCHIVE', 'company', targetId, item.name, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const idx = list.findIndex(j => j.jobId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.JOBS, list);
        this.recordMasterAuditLog('ARCHIVE', 'job', targetId, item.title || item.jobName, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const idx = list.findIndex(c => c.consultantId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, status: 'inactive', archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.CONSULTANTS, list);
        this.recordMasterAuditLog('ARCHIVE', 'consultant', targetId, item.name, null, 'isArchived: true', reason);
      }
    }
  }

  // --- 復元機能 (指示書 12項) ---
  restoreMasterItem(masterType, targetId) {
    const user = this.getCurrentConsultant();

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const idx = list.findIndex(c => c.candidateId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.CANDIDATES, list);
        this.recordMasterAuditLog('RESTORE', 'candidate', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const idx = list.findIndex(c => c.companyId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.COMPANIES, list);
        this.recordMasterAuditLog('RESTORE', 'company', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const idx = list.findIndex(j => j.jobId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.JOBS, list);
        this.recordMasterAuditLog('RESTORE', 'job', targetId, item.title || item.jobName, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const idx = list.findIndex(c => c.consultantId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, status: 'active', restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.CONSULTANTS, list);
        this.recordMasterAuditLog('RESTORE', 'consultant', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    }
  }

  // --- 管理者限定 完全物理削除 (指示書 3, 7, 8, 9, 10項) ---
  deleteMasterItemPermanently(masterType, targetId) {
    if (!this.isAdmin()) {
      alert('完全削除権限がありません。管理者アカウントで実行してください。');
      return false;
    }

    const counts = this.getRelatedDataCounts(masterType, targetId);
    if (counts.hasRelatedData) {
      alert('関連データが存在するため完全削除できません。アーカイブ機能をご利用ください。');
      return false;
    }

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const item = list.find(c => c.candidateId === targetId);
      const newList = list.filter(c => c.candidateId !== targetId);
      this.setItem(STORAGE_KEYS.CANDIDATES, newList);
      this.recordMasterAuditLog('DELETE', 'candidate', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const item = list.find(c => c.companyId === targetId);
      const newList = list.filter(c => c.companyId !== targetId);
      this.setItem(STORAGE_KEYS.COMPANIES, newList);
      this.recordMasterAuditLog('DELETE', 'company', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const item = list.find(j => j.jobId === targetId);
      const newList = list.filter(j => j.jobId !== targetId);
      this.setItem(STORAGE_KEYS.JOBS, newList);
      this.recordMasterAuditLog('DELETE', 'job', targetId, item ? (item.title || item.jobName) : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const item = list.find(c => c.consultantId === targetId);
      const newList = list.filter(c => c.consultantId !== targetId);
      this.setItem(STORAGE_KEYS.CONSULTANTS, newList);
      this.recordMasterAuditLog('DELETE', 'consultant', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    }

    return true;
  }

  // --- Getters ---
  getConsultants(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getCaConsultants() {
    return this.getConsultants().filter(c => {
      if (c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) {
        return c.roles.includes('CA') || c.roles.includes('ADMIN');
      }
      return c.roleType === 'CA' || c.roleType === 'ADMIN';
    });
  }

  getRaConsultants() {
    return this.getConsultants().filter(c => {
      if (c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) {
        return c.roles.includes('RA') || c.roles.includes('ADMIN');
      }
      return c.roleType === 'RA' || c.roleType === 'ADMIN';
    });
  }

  getCompanies(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.COMPANIES);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getJobs(includeArchived = false, companyId = null) {
    let list = this.getItem(STORAGE_KEYS.JOBS);
    if (!includeArchived) list = list.filter(j => !j.isArchived);
    if (companyId) list = list.filter(j => j.companyId === companyId);
    return list;
  }

  getCandidates(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.CANDIDATES);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getSelections(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.SELECTIONS);
    return includeArchived ? list : list.filter(s => !s.isArchived);
  }

  getTargets(year = 2026, month = 7) {
    const list = this.getItem(STORAGE_KEYS.TARGETS);
    return list.filter(t => t.year === year && t.month === month);
  }

  getHistories(selectionId = null) {
    const list = this.getItem(STORAGE_KEYS.HISTORIES);
    let filtered = selectionId ? list.filter(h => h.selectionId === selectionId) : list;
    return filtered.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  }

  getEmailTemplates() {
    return this.getItem(STORAGE_KEYS.EMAIL_TEMPLATES);
  }

  getCompanyCommunications(companyId = null) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    if (companyId) return list.filter(c => c.companyId === companyId);
    return list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  getCompanySubmissions(companyId = null) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    let filtered = companyId ? list.filter(s => s.companyId === companyId) : list;
    return filtered.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }

  getLastCompanySubmission(companyId) {
    const list = this.getCompanySubmissions(companyId);
    return list.length > 0 ? list[0] : null;
  }

  // --- 保存処理 (名義動的更新ロジック付き) (指示書 5項) ---
  saveCandidate(candidateData, cascadeToSelections = false) {
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const consultants = this.getConsultants(true);
    const caCons = consultants.find(c => c.consultantId === candidateData.caId);

    candidateData.caName = caCons ? caCons.name : '未設定';
    candidateData.caConsultantId = candidateData.caId;
    candidateData.updatedAt = new Date().toISOString();
    candidateData.updatedBy = this.getCurrentConsultant().name;

    const existingIndex = candidates.findIndex(c => c.candidateId === candidateData.candidateId);
    let isNew = false;
    let oldName = '';

    if (existingIndex >= 0) {
      oldName = candidates[existingIndex].name;
      candidates[existingIndex] = { ...candidates[existingIndex], ...candidateData };
      this.recordMasterAuditLog('UPDATE', 'candidate', candidateData.candidateId, candidateData.name, `name:${oldName}`, `name:${candidateData.name}`);
    } else {
      isNew = true;
      candidateData.candidateId = candidateData.candidateId || 'cand_' + Date.now();
      candidateData.createdAt = new Date().toISOString();
      candidateData.createdBy = this.getCurrentConsultant().name;
      candidateData.isArchived = false;
      candidates.push(candidateData);
      this.recordMasterAuditLog('CREATE', 'candidate', candidateData.candidateId, candidateData.name);
    }

    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);

    // 候補者名変更時の選考案件表示名一括更新 (指示書 5項)
    if (!isNew && oldName && oldName !== candidateData.name) {
      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let updated = false;
      selections.forEach(s => {
        if (s.candidateId === candidateData.candidateId) {
          s.candidateName = candidateData.name;
          s.updatedAt = new Date().toISOString();
          updated = true;
        }
      });
      if (updated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveCompany(companyData, cascadeToSelections = false) {
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const consultants = this.getConsultants(true);
    const raCons = consultants.find(c => c.consultantId === companyData.primaryRaId);

    if (companyData.contactName && !companyData.contactPerson) companyData.contactPerson = companyData.contactName;
    if (companyData.contactPerson && !companyData.contactName) companyData.contactName = companyData.contactPerson;

    companyData.primaryRaName = raCons ? raCons.name : '未設定';
    companyData.raConsultantId = companyData.primaryRaId;
    companyData.updatedAt = new Date().toISOString();
    companyData.updatedBy = this.getCurrentConsultant().name;

    const existingIndex = companies.findIndex(c => c.companyId === companyData.companyId);
    let isNew = false;
    let oldName = '';

    if (existingIndex >= 0) {
      oldName = companies[existingIndex].name;
      companies[existingIndex] = { ...companies[existingIndex], ...companyData };
      this.recordMasterAuditLog('UPDATE', 'company', companyData.companyId, companyData.name, `name:${oldName}`, `name:${companyData.name}`);
    } else {
      isNew = true;
      companyData.companyId = companyData.companyId || 'comp_' + Date.now();
      companyData.createdAt = new Date().toISOString();
      companyData.createdBy = this.getCurrentConsultant().name;
      companyData.isArchived = false;
      companies.push(companyData);
      this.recordMasterAuditLog('CREATE', 'company', companyData.companyId, companyData.name);
    }

    this.setItem(STORAGE_KEYS.COMPANIES, companies);

    // 企業名変更時の求人・選考案件表示名一括更新 (指示書 5項)
    if (!isNew && oldName && oldName !== companyData.name) {
      const jobs = this.getItem(STORAGE_KEYS.JOBS);
      let jobsUpdated = false;
      jobs.forEach(j => {
        if (j.companyId === companyData.companyId) {
          j.companyName = companyData.name;
          jobsUpdated = true;
        }
      });
      if (jobsUpdated) this.setItem(STORAGE_KEYS.JOBS, jobs);

      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let selUpdated = false;
      selections.forEach(s => {
        if (s.companyId === companyData.companyId) {
          s.companyName = companyData.name;
          s.updatedAt = new Date().toISOString();
          selUpdated = true;
        }
      });
      if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveJob(jobData) {
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const companies = this.getCompanies(true);
    const comp = companies.find(c => c.companyId === jobData.companyId);

    jobData.companyName = comp ? comp.name : '';
    jobData.raConsultantId = jobData.raId || (comp ? comp.primaryRaId : 'c3');
    jobData.raId = jobData.raConsultantId;
    jobData.updatedAt = new Date().toISOString();

    const idx = jobs.findIndex(j => j.jobId === jobData.jobId);
    let isNew = false;
    let oldTitle = '';

    if (idx >= 0) {
      oldTitle = jobs[idx].title || jobs[idx].jobName;
      jobs[idx] = { ...jobs[idx], ...jobData };
      this.recordMasterAuditLog('UPDATE', 'job', jobData.jobId, jobData.title || jobData.jobName, `title:${oldTitle}`, `title:${jobData.title}`);
    } else {
      isNew = true;
      jobData.jobId = jobData.jobId || 'job_' + Date.now();
      jobData.createdAt = new Date().toISOString();
      jobData.isArchived = false;
      jobs.push(jobData);
      this.recordMasterAuditLog('CREATE', 'job', jobData.jobId, jobData.title || jobData.jobName);
    }

    this.setItem(STORAGE_KEYS.JOBS, jobs);

    // 求人名変更時の選考案件表示名一括更新 (指示書 5項)
    const newTitle = jobData.title || jobData.jobName;
    if (!isNew && oldTitle && oldTitle !== newTitle) {
      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let selUpdated = false;
      selections.forEach(s => {
        if (s.jobId === jobData.jobId) {
          s.jobName = newTitle;
          s.updatedAt = new Date().toISOString();
          selUpdated = true;
        }
      });
      if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveConsultant(consultantData) {
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
    const idx = list.findIndex(c => c.consultantId === consultantData.consultantId);

    if (idx >= 0) {
      const oldName = list[idx].name;
      list[idx] = { ...list[idx], ...consultantData };
      this.recordMasterAuditLog('UPDATE', 'consultant', consultantData.consultantId, consultantData.name, `name:${oldName}`, `name:${consultantData.name}`);
    } else {
      consultantData.consultantId = consultantData.consultantId || 'c_' + Date.now();
      consultantData.isArchived = false;
      consultantData.createdAt = new Date().toISOString();
      consultantData.status = consultantData.status || 'active';
      list.push(consultantData);
      this.recordMasterAuditLog('CREATE', 'consultant', consultantData.consultantId, consultantData.name);
    }
    this.setItem(STORAGE_KEYS.CONSULTANTS, list);
  }

  // --- ワンクリック操作 ＆ 自動バトン連携 (指示書 18, 19, 20, 21, 22項) ---
  handleRaAction(selectionId, actionType, customParams = {}) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const idx = selections.findIndex(s => s.selectionId === selectionId);
    if (idx < 0) return;

    const sel = selections[idx];
    const user = this.getCurrentConsultant();
    const todayStr = new Date().toISOString().split('T')[0];

    const next2BizDays = new Date();
    next2BizDays.setDate(next2BizDays.getDate() + 2);
    const next2BizStr = next2BizDays.toISOString().split('T')[0];

    let currentBall = sel.currentBall || 'RA';
    let companyActionStatus = sel.companyActionStatus || '要企業対応';
    let nextAction = sel.nextAction || '';

    let logTitle = '';
    let logDetail = '';

    if (actionType === 'CONTACTED') {
      currentBall = 'COMPANY';
      companyActionStatus = '企業回答待ち';
      nextAction = '企業からの回答待ち';
      sel.lastContactDate = todayStr;
      sel.nextFollowDate = next2BizStr;
      logTitle = 'RA：企業へ連絡済み';
      logDetail = '現在のボール: RA → 企業（状態: 企業回答待ち）';
    } else if (actionType === 'PASS') {
      currentBall = 'CA';
      companyActionStatus = 'CA確認待ち';
      nextAction = '候補者へ通過連絡';
      sel.lastCompanyResponseDate = todayStr;
      logTitle = 'RA：通過登録';
      logDetail = '現在のボール: 企業 → CA（次の行動: 候補者へ通過連絡）';
    } else if (actionType === 'REJECT') {
      currentBall = 'CA';
      companyActionStatus = 'CA確認待ち';
      nextAction = '候補者へ見送り連絡';
      sel.lastCompanyResponseDate = todayStr;
      logTitle = 'RA：見送り登録';
      logDetail = '現在のボール: 企業 → CA（次の行動: 候補者へ見送り連絡）';
    } else if (actionType === 'DATES_AVAILABLE') {
      currentBall = 'CA';
      companyActionStatus = 'CA確認待ち';
      nextAction = '候補者へ候補日確認';
      sel.lastCompanyResponseDate = todayStr;
      logTitle = 'RA：日程候補あり';
      logDetail = '現在のボール: 企業 → CA（次の行動: 候補者へ候補日確認）';
    } else if (actionType === 'OFFER_AVAILABLE') {
      currentBall = 'CA';
      companyActionStatus = 'CA確認待ち';
      nextAction = '候補者へ条件提示・意向確認';
      sel.lastCompanyResponseDate = todayStr;
      logTitle = 'RA：条件提示あり';
      logDetail = '現在のボール: 企業 → CA（次の行動: 候補者へ条件提示・意向確認）';
    } else if (actionType === 'HOLD') {
      currentBall = 'RA';
      companyActionStatus = '企業対応中';
      nextAction = '企業へ再確認';
      logTitle = 'RA：回答保留';
      logDetail = '現在のボール: RA（次の行動: 企業へ再確認）';
    }

    selections[idx] = {
      ...sel,
      ...customParams,
      currentBall,
      companyActionStatus,
      nextAction,
      updatedAt: new Date().toISOString(),
      updatedBy: user.name
    };

    this.addHistoryRecord(selectionId, logTitle, logDetail, 'RA');
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  handleCaAction(selectionId, actionType, customParams = {}) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const idx = selections.findIndex(s => s.selectionId === selectionId);
    if (idx < 0) return;

    const sel = selections[idx];
    const user = this.getCurrentConsultant();
    const todayStr = new Date().toISOString().split('T')[0];

    let currentBall = sel.currentBall || 'CA';
    let companyActionStatus = sel.companyActionStatus || 'CA対応中';
    let nextAction = sel.nextAction || '';

    let logTitle = '';
    let logDetail = '';

    if (actionType === 'CONTACTED') {
      currentBall = 'CA';
      sel.lastCaContactDate = todayStr;
      logTitle = 'CA：候補者へ連絡済み';
      logDetail = '候補者への連絡日を更新しました。';
    } else if (actionType === 'GOT_DATES') {
      currentBall = 'RA';
      companyActionStatus = '要企業対応';
      nextAction = '企業へ候補日を提出';
      logTitle = 'CA：候補日を取得';
      logDetail = '現在のボール: CA → RA（次の行動: 企業へ候補日を提出）';
    } else if (actionType === 'WAITING_CANDIDATE') {
      currentBall = 'CA';
      nextAction = '候補者からの回答待ち';
      logTitle = 'CA：候補者回答待ち';
      logDetail = '現在のボール: CA（次の行動: 候補者からの回答待ち）';
    } else if (actionType === 'ACCEPT_INTENT') {
      currentBall = 'RA';
      companyActionStatus = '要企業対応';
      nextAction = '企業へ内定承諾を連絡';
      logTitle = 'CA：承諾意向確認';
      logDetail = '現在のボール: CA → RA（次の行動: 企業へ内定承諾を連絡）';
    } else if (actionType === 'CONSIDER') {
      currentBall = 'CA';
      nextAction = '意向醸成フォロー';
      logTitle = 'CA：検討中';
      logDetail = '意向醸成フォローを継続します。';
    } else if (actionType === 'DECLINE_INTENT') {
      currentBall = 'RA';
      companyActionStatus = '要企業対応';
      nextAction = '企業へ辞退連絡';
      logTitle = 'CA：辞退意向';
      logDetail = '現在のボール: CA → RA（次の行動: 企業へ辞退連絡）';
    }

    selections[idx] = {
      ...sel,
      ...customParams,
      currentBall,
      companyActionStatus,
      nextAction,
      updatedAt: new Date().toISOString(),
      updatedBy: user.name
    };

    this.addHistoryRecord(selectionId, logTitle, logDetail, 'CA');
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  addHistoryRecord(selectionId, title, detail, role = 'SYSTEM') {
    const histories = this.getItem(STORAGE_KEYS.HISTORIES);
    const user = this.getCurrentConsultant();

    histories.push({
      historyId: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      selectionId,
      actionTitle: title,
      detail,
      role,
      changedBy: user.name,
      changedAt: new Date().toISOString()
    });

    this.setItem(STORAGE_KEYS.HISTORIES, histories);
  }

  saveCompanySubmission(submissionData) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const user = this.getCurrentConsultant();
    const comp = this.getCompanies(true).find(c => c.companyId === submissionData.companyId);

    const newSub = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      companyId: submissionData.companyId,
      companyName: comp ? comp.name : (submissionData.companyName || ''),
      selectionIds: submissionData.selectionIds || [],
      candidateIds: submissionData.candidateIds || [],
      jobIds: submissionData.jobIds || [],
      submissionPurpose: submissionData.submissionPurpose || '選考進捗の一括確認',
      outputType: submissionData.outputType || 'EXCEL',
      templateId: submissionData.templateId || '',
      subject: submissionData.subject || '',
      body: submissionData.body || '',
      submittedAt: new Date().toISOString(),
      submittedBy: user.consultantId,
      submittedByName: user.name,
      targetCount: submissionData.selectionIds ? submissionData.selectionIds.length : 0,
      nextContactDate: submissionData.nextContactDate || null,
      responseStatus: '未回答',
      responses: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.push(newSub);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, list);

    if (comp) {
      comp.lastContactDate = new Date().toISOString().split('T')[0];
      if (submissionData.nextContactDate) comp.nextContactDate = submissionData.nextContactDate;
      this.saveCompany(comp, false);
    }

    return newSub;
  }

  addSelection(selectionData) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const candidates = this.getCandidates(true);
    const companies = this.getCompanies(true);
    const jobs = this.getJobs(true);
    const consultants = this.getConsultants(true);

    const cand = candidates.find(c => c.candidateId === selectionData.candidateId);
    const comp = companies.find(c => c.companyId === selectionData.companyId);
    const job = jobs.find(j => j.jobId === selectionData.jobId);

    const caId = selectionData.caId || selectionData.caConsultantId || (cand ? cand.caId : 'c2');
    const raId = selectionData.raId || selectionData.raConsultantId || (job ? job.raId : (comp ? comp.primaryRaId : 'c3'));

    const caCons = consultants.find(c => c.consultantId === caId);
    const raCons = consultants.find(c => c.consultantId === raId);

    const newSelection = {
      selectionId: 'sel_' + Date.now(),
      candidateId: selectionData.candidateId,
      candidateName: cand ? cand.name : selectionData.candidateName || '不明',
      companyId: selectionData.companyId,
      companyName: comp ? comp.name : selectionData.companyName || '不明',
      jobId: selectionData.jobId,
      jobName: job ? (job.title || job.jobName) : selectionData.jobName || '不明',
      caId: caId,
      caConsultantId: caId,
      caName: caCons ? caCons.name : '未設定',
      raId: raId,
      raConsultantId: raId,
      raName: raCons ? raCons.name : '未設定',
      entrySource: selectionData.entrySource || 'UNSET',
      entrySourceDetail: selectionData.entrySourceDetail || '',
      recommendationDate: selectionData.recommendationDate || new Date().toISOString().split('T')[0],
      phase: selectionData.phase || '書類選考',
      progressStatus: selectionData.progressStatus || '未対応',
      phaseUpdatedAt: new Date().toISOString(),
      nextScheduleDate: selectionData.nextScheduleDate || null,
      expectedCompletionMonth: selectionData.expectedCompletionMonth || null,
      selectionEndDate: null,
      endReason: null,
      endReasonDetail: '',
      yomi: selectionData.yomi !== undefined ? Number(selectionData.yomi) : 0.25,
      yomiReason: selectionData.yomiReason || '新規案件登録',
      yomiUpdatedAt: new Date().toISOString(),
      yomiUpdatedBy: this.getCurrentConsultant().name,
      nextAction: selectionData.nextAction || '',
      actionDeadline: selectionData.actionDeadline || null,
      companyActionType: selectionData.companyActionType || '書類選考結果の確認',
      companyConfirmationItem: selectionData.companyConfirmationItem || '',
      companyActionStatus: selectionData.companyActionStatus || '未対応',
      internalMemo: selectionData.internalMemo || '',
      companySharedComment: selectionData.companySharedComment || '',
      createdAt: new Date().toISOString(),
      createdBy: this.getCurrentConsultant().name,
      updatedAt: new Date().toISOString(),
      updatedBy: this.getCurrentConsultant().name,
      isArchived: false
    };

    selections.push(newSelection);
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    this.recordHistory(newSelection.selectionId, '新規案件登録', '-', newSelection.phase, '新規選考案件を作成');

    return newSelection;
  }

  updateSelection(selectionId, updateFields, historyComment = '', options = {}) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const index = selections.findIndex(s => s.selectionId === selectionId);
    if (index < 0) return;

    const currentSelection = selections[index];
    let updatedSelection = { ...currentSelection, ...updateFields };
    updatedSelection.updatedAt = new Date().toISOString();
    updatedSelection.updatedBy = this.getCurrentConsultant().name;

    // CA更新連動によるRA企業対応項目の自動判定 (指示書 1, 3, 4, 5, 7, 8, 9, 10, 22項)
    const isPhaseChanged = updateFields.phase && updateFields.phase !== currentSelection.phase;
    const isStatusChanged = updateFields.progressStatus && updateFields.progressStatus !== currentSelection.progressStatus;
    const isScheduleChanged = updateFields.nextScheduleDate && updateFields.nextScheduleDate !== currentSelection.nextScheduleDate;

    if (isPhaseChanged || isStatusChanged || isScheduleChanged || options.forceAuto) {
      const currentSource = updateFields.companyActionSource || currentSelection.companyActionSource || 'auto';

      // 手動設定済みでかつ forceAuto でなく、手動指定が更新フィールドに含まれていない場合の保護判定 (指示書 8, 10, 12項)
      const hasManualAction = (currentSource === 'manual') && !options.forceAuto && !updateFields.companyActionType;

      if (!hasManualAction) {
        // 自動連動判定を実行
        const derived = deriveCompanyActionFromSelection({
          phase: updatedSelection.phase,
          progressStatus: updatedSelection.progressStatus,
          recommendationDate: updatedSelection.recommendationDate,
          nextScheduleDate: updatedSelection.nextScheduleDate,
          currentCompanyAction: currentSelection
        });

        updatedSelection = {
          ...updatedSelection,
          companyActionType: derived.companyActionType,
          companyActionStatus: derived.companyActionStatus,
          companyConfirmationItem: (options.appendItem && currentSelection.companyConfirmationItem)
            ? `${currentSelection.companyConfirmationItem} / 【自動判定】${derived.companyConfirmationItem}`
            : (derived.companyConfirmationItem || updatedSelection.companyConfirmationItem || ''),
          nextAction: derived.nextAction,
          nextActionTarget: derived.nextActionTarget,
          actionDeadline: derived.actionDeadline || updatedSelection.actionDeadline,
          nextCompanyContactDate: derived.nextCompanyContactDate || updatedSelection.nextCompanyContactDate,
          companyActionSource: 'auto',
          companyActionUpdatedAt: new Date().toISOString(),
          companyActionUpdatedBy: this.getCurrentConsultant().name
        };

        // 連動履歴の記録 (指示書 22項)
        if (isPhaseChanged || isStatusChanged) {
          this.recordHistory(
            selectionId,
            '企業対応項目連動',
            `${currentSelection.companyActionType || '-'} (${currentSelection.companyActionStatus || '未対応'})`,
            `${derived.companyActionType} (${derived.companyActionStatus})`,
            `選考フェーズ・進行状態の変更に伴うRA自動連動更新 [CA_SELECTION_UPDATE]`
          );
        }
      }
    }

    if (isPhaseChanged) {
      updatedSelection.phaseUpdatedAt = new Date().toISOString();
      this.recordHistory(selectionId, '選考フェーズ', currentSelection.phase, updateFields.phase, historyComment);
    }

    if (updateFields.yomi !== undefined && Number(updateFields.yomi) !== Number(currentSelection.yomi)) {
      updatedSelection.yomiUpdatedAt = new Date().toISOString();
      updatedSelection.yomiUpdatedBy = this.getCurrentConsultant().name;
      this.recordHistory(selectionId, 'ヨミ', `${currentSelection.yomi * 100}%`, `${updateFields.yomi * 100}%`, historyComment || updateFields.yomiReason);
    }

    selections[index] = updatedSelection;
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  declineOtherSelectionsForCandidate(candidateId, targetSelectionId, reasonComment = '') {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    let updated = false;

    selections.forEach(s => {
      if (s.candidateId === candidateId && s.selectionId !== targetSelectionId && !s.isArchived && s.phase !== '選考終了') {
        s.phase = '選考終了';
        s.progressStatus = '候補者辞退';
        s.endReason = '内定辞退';
        s.endReasonDetail = reasonComment || '他社内定承諾に伴う辞退';
        s.yomi = 0;
        s.updatedAt = new Date().toISOString();
        updated = true;
        this.recordHistory(s.selectionId, '他社内定連動', s.phase, '選考終了 (候補者辞退)', reasonComment);
      }
    });

    if (updated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  recordHistory(selectionId, fieldName, previousValue, newValue, comment = '') {
    const histories = this.getItem(STORAGE_KEYS.HISTORIES);
    const newHistory = {
      historyId: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      selectionId,
      changedAt: new Date().toISOString(),
      changedBy: this.getCurrentConsultant().name,
      fieldName,
      previousValue: String(previousValue),
      newValue: String(newValue),
      comment
    };

    histories.push(newHistory);
    this.setItem(STORAGE_KEYS.HISTORIES, histories);
  }

  archiveSelection(selectionId) {
    this.updateSelection(selectionId, { isArchived: true }, 'アーカイブ化');
  }

  saveTarget(targetData) {
    const targets = this.getItem(STORAGE_KEYS.TARGETS);
    const idx = targets.findIndex(t => t.consultantId === targetData.consultantId && t.year === targetData.year && t.month === targetData.month);
    if (idx >= 0) {
      targets[idx] = { ...targets[idx], ...targetData };
    } else {
      targetData.targetId = 't_' + Date.now();
      targets.push(targetData);
    }
    this.setItem(STORAGE_KEYS.TARGETS, targets);
  }

  // --- データ管理 ＆ 初期化 ＆ 監査ログ機能 (指示書 4〜22項) ---

  recordAuditLog(operationType, targetCounts = {}, result = 'SUCCESS', errorMessage = '') {
    const logs = this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
    const current = this.getCurrentConsultant();
    const log = {
      id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      operationType,
      targetCounts,
      executedBy: current.consultantId || 'unknown',
      executedByName: current.name || '不明',
      executedAt: new Date().toISOString(),
      result,
      errorMessage
    };
    logs.unshift(log);
    this.setItem(STORAGE_KEYS.MASTER_AUDIT_LOGS, logs.slice(0, 100)); // 最新100件保存
    return log;
  }

  getAuditLogs() {
    return this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
  }

  getDeletionPreviewCounts() {
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const histories = this.getItem(STORAGE_KEYS.HISTORIES);
    const companyCommunications = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    const companySubmissions = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS);
    const emailTemplates = this.getItem(STORAGE_KEYS.EMAIL_TEMPLATES);

    const isDemoItem = item => Boolean(item.isDemo || item.createdBySeed);

    return {
      demo: {
        candidates: candidates.filter(isDemoItem).length,
        companies: companies.filter(isDemoItem).length,
        jobs: jobs.filter(isDemoItem).length,
        selections: selections.filter(isDemoItem).length,
        histories: histories.filter(isDemoItem).length,
        companyCommunications: companyCommunications.filter(isDemoItem).length,
        companySubmissions: companySubmissions.filter(isDemoItem).length,
        qTargets: qTargets.filter(isDemoItem).length,
        emailTemplates: emailTemplates.filter(isDemoItem).length,
        total: candidates.filter(isDemoItem).length +
               companies.filter(isDemoItem).length +
               jobs.filter(isDemoItem).length +
               selections.filter(isDemoItem).length +
               histories.filter(isDemoItem).length +
               companyCommunications.filter(isDemoItem).length +
               qTargets.filter(isDemoItem).length
      },
      all: {
        candidates: candidates.length,
        companies: companies.length,
        jobs: jobs.length,
        selections: selections.length,
        histories: histories.length,
        companyCommunications: companyCommunications.length,
        companySubmissions: companySubmissions.length,
        qTargets: qTargets.length,
        emailTemplates: emailTemplates.length,
        total: candidates.length + companies.length + jobs.length + selections.length + histories.length + companyCommunications.length + qTargets.length
      }
    };
  }

  deleteDemoData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const isDemoItem = item => Boolean(item.isDemo || item.createdBySeed);

    const demoSelections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(isDemoItem);
    const demoSelectionIds = new Set(demoSelections.map(s => s.selectionId));

    // 削除対象カウント
    const previewCounts = this.getDeletionPreviewCounts().demo;

    // 1. 子データから削除
    const histories = this.getItem(STORAGE_KEYS.HISTORIES).filter(h => !isDemoItem(h) && !demoSelectionIds.has(h.selectionId));
    const comms = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS).filter(c => !isDemoItem(c) && !demoSelectionIds.has(c.selectionId));
    const subs = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS).filter(s => !isDemoItem(s) && !demoSelectionIds.has(s.selectionId));
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(s => !isDemoItem(s));
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES).filter(c => !isDemoItem(c));
    const jobs = this.getItem(STORAGE_KEYS.JOBS).filter(j => !isDemoItem(j));
    const companies = this.getItem(STORAGE_KEYS.COMPANIES).filter(c => !isDemoItem(c));
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS).filter(q => !isDemoItem(q));

    // 削除対象の Firestore ドキュメント物理消去
    const itemsToDelete = [
      ...this.getItem(STORAGE_KEYS.HISTORIES).filter(h => isDemoItem(h) || demoSelectionIds.has(h.selectionId)).map(i => ({ col: 'histories', id: i.historyId })),
      ...this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS).filter(c => isDemoItem(c) || demoSelectionIds.has(c.selectionId)).map(i => ({ col: 'companyCommunications', id: i.id })),
      ...demoSelections.map(i => ({ col: 'selections', id: i.selectionId })),
      ...this.getItem(STORAGE_KEYS.CANDIDATES).filter(isDemoItem).map(i => ({ col: 'candidates', id: i.candidateId })),
      ...this.getItem(STORAGE_KEYS.JOBS).filter(isDemoItem).map(i => ({ col: 'jobs', id: i.jobId })),
      ...this.getItem(STORAGE_KEYS.COMPANIES).filter(isDemoItem).map(i => ({ col: 'companies', id: i.companyId })),
      ...this.getItem(STORAGE_KEYS.Q_TARGETS).filter(isDemoItem).map(i => ({ col: 'qTargets', id: i.targetId }))
    ];

    itemsToDelete.forEach(item => {
      if (item.id) deleteFirestoreDoc(item.col, item.id);
    });

    this.setItem(STORAGE_KEYS.HISTORIES, histories);
    this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, comms);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, subs);
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);
    this.setItem(STORAGE_KEYS.JOBS, jobs);
    this.setItem(STORAGE_KEYS.COMPANIES, companies);
    this.setItem(STORAGE_KEYS.Q_TARGETS, qTargets);

    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('DELETE_DEMO_DATA', previewCounts);
    this.notifyListeners();

    return previewCounts;
  }

  deleteSelectedDataTypes(selectedTypes = []) {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const typesSet = new Set(selectedTypes);
    const deletedCounts = {};

    if (typesSet.has('histories') || typesSet.has('selections')) {
      deletedCounts.histories = this.getItem(STORAGE_KEYS.HISTORIES).length;
      this.setItem(STORAGE_KEYS.HISTORIES, []);
    }
    if (typesSet.has('communications') || typesSet.has('selections')) {
      deletedCounts.companyCommunications = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS).length;
      this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, []);
    }
    if (typesSet.has('submissions') || typesSet.has('selections')) {
      deletedCounts.companySubmissions = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS).length;
      this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, []);
    }
    if (typesSet.has('selections')) {
      deletedCounts.selections = this.getItem(STORAGE_KEYS.SELECTIONS).length;
      this.setItem(STORAGE_KEYS.SELECTIONS, []);
    }
    if (typesSet.has('candidates')) {
      deletedCounts.candidates = this.getItem(STORAGE_KEYS.CANDIDATES).length;
      this.setItem(STORAGE_KEYS.CANDIDATES, []);
    }
    if (typesSet.has('jobs')) {
      deletedCounts.jobs = this.getItem(STORAGE_KEYS.JOBS).length;
      this.setItem(STORAGE_KEYS.JOBS, []);
    }
    if (typesSet.has('companies')) {
      deletedCounts.companies = this.getItem(STORAGE_KEYS.COMPANIES).length;
      this.setItem(STORAGE_KEYS.COMPANIES, []);
    }
    if (typesSet.has('qTargets')) {
      deletedCounts.qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS).length;
      this.setItem(STORAGE_KEYS.Q_TARGETS, []);
    }

    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('DELETE_SELECTED_DATA', { selectedTypes, ...deletedCounts });
    this.notifyListeners();

    return deletedCounts;
  }

  resetAllBusinessData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const previewCounts = this.getDeletionPreviewCounts().all;

    // 業務データを全て空配列にセット（コンサルタント・認証・システム設定は保護）
    this.setItem(STORAGE_KEYS.SELECTIONS, []);
    this.setItem(STORAGE_KEYS.CANDIDATES, []);
    this.setItem(STORAGE_KEYS.JOBS, []);
    this.setItem(STORAGE_KEYS.COMPANIES, []);
    this.setItem(STORAGE_KEYS.HISTORIES, []);
    this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, []);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, []);
    this.setItem(STORAGE_KEYS.TARGETS, []);
    this.setItem(STORAGE_KEYS.Q_TARGETS, []);
    this.setItem(STORAGE_KEYS.Q_TARGET_HISTORIES, []);

    // デモ再自動生成を停止する初期化フラグを確実に立てる
    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('RESET_ALL_BUSINESS_DATA', previewCounts);
    this.notifyListeners();

    return previewCounts;
  }

  seedDemoData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    this.setItem(STORAGE_KEYS.COMPANIES, INITIAL_COMPANIES);
    this.setItem(STORAGE_KEYS.JOBS, INITIAL_JOBS);
    this.setItem(STORAGE_KEYS.CANDIDATES, INITIAL_CANDIDATES);
    this.setItem(STORAGE_KEYS.SELECTIONS, INITIAL_SELECTIONS);
    this.setItem(STORAGE_KEYS.Q_TARGETS, INITIAL_Q_TARGETS);
    this.setItem(STORAGE_KEYS.EMAIL_TEMPLATES, INITIAL_EMAIL_TEMPLATES);
    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    const counts = {
      candidates: INITIAL_CANDIDATES.length,
      companies: INITIAL_COMPANIES.length,
      jobs: INITIAL_JOBS.length,
      selections: INITIAL_SELECTIONS.length
    };

    this.recordAuditLog('CREATE_DEMO_DATA', counts);
    this.notifyListeners();

    return counts;
  }
}

const store = new Store();


/**
 * 選考進捗・ヨミ管理システム - ヨミ計算 & 年度・四半期（Q）判定共通ユーティリティ (型安全防御 ＆ 選考終了・内定辞退厳格除外対応)
 */

/**
 * 日付から10月開始の年度（Fiscal Year）を判定
 */
function getFiscalYear(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return 2025;

  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12

  if (month >= 10) {
    return year;
  } else {
    return year - 1;
  }
}

/**
 * 日付から四半期 (Q1, Q2, Q3, Q4) を判定
 */
function getFiscalQuarter(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return 'Q4';

  const month = d.getMonth() + 1;
  if (month >= 10 && month <= 12) return 'Q1';
  if (month >= 1 && month <= 3) return 'Q2';
  if (month >= 4 && month <= 6) return 'Q3';
  return 'Q4';
}

/**
 * 当日・指定日付から年度・Q・対象期間情報をまとめて取得する共通関数 (指示書 3, 5項)
 */
function getFiscalQuarterFromDate(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const fiscalYear = getFiscalYear(validDate);
  const quarter = getFiscalQuarter(validDate);
  const quarterNum = parseInt(quarter.replace('Q', ''), 10);
  const rangeInfo = getQuarterDateRange(fiscalYear, quarter);

  return {
    fiscalYear,
    quarter,
    quarterNum,
    startDate: rangeInfo.startDate,
    endDate: rangeInfo.endDate,
    label: rangeInfo.label,
    months: rangeInfo.months
  };
}

/**
 * ヨミの保存形式の揺れを 0〜1 の小数へ正規化する共通関数 (指示書 9項)
 * 例: 75 -> 0.75, "75%" -> 0.75, "75" -> 0.75, 0.75 -> 0.75, 不正値 -> 0
 */
function normalizeYomi(value) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'string') {
    let cleaned = value.trim().replace(/%/g, '');
    let num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    if (num > 1) return Math.min(1, Math.max(0, num / 100));
    return Math.min(1, Math.max(0, num));
  }

  if (typeof value === 'number') {
    if (isNaN(value)) return 0;
    if (value > 1) return Math.min(1, Math.max(0, value / 100));
    return Math.min(1, Math.max(0, value));
  }

  return 0;
}

/**
 * 年度とQから開始日・終了日・ラベルを取得
 */
function getQuarterDateRange(fiscalYear, quarter) {
  const fy = parseInt(fiscalYear, 10);
  let startDate = '';
  let endDate = '';
  let label = '';
  let months = [];

  if (quarter === 'Q1') {
    startDate = `${fy}-10-01`;
    endDate = `${fy}-12-31`;
    label = `${fy}年度 1Q (${fy}年10月〜12月)`;
    months = [`${fy}-10`, `${fy}-11`, `${fy}-12`];
  } else if (quarter === 'Q2') {
    startDate = `${fy + 1}-01-01`;
    endDate = `${fy + 1}-03-31`;
    label = `${fy}年度 2Q (${fy + 1}年1月〜3月)`;
    months = [`${fy + 1}-01`, `${fy + 1}-02`, `${fy + 1}-03`];
  } else if (quarter === 'Q3') {
    startDate = `${fy + 1}-04-01`;
    endDate = `${fy + 1}-06-30`;
    label = `${fy}年度 3Q (${fy + 1}年4月〜6月)`;
    months = [`${fy + 1}-04`, `${fy + 1}-05`, `${fy + 1}-06`];
  } else if (quarter === 'Q4') {
    startDate = `${fy + 1}-07-01`;
    endDate = `${fy + 1}-09-30`;
    label = `${fy}年度 4Q (${fy + 1}年7月〜9月)`;
    months = [`${fy + 1}-07`, `${fy + 1}-08`, `${fy + 1}-09`];
  } else {
    // 年度合計
    startDate = `${fy}-10-01`;
    endDate = `${fy + 1}-09-30`;
    label = `${fy}年度 通期 (${fy}年10月〜${fy + 1}年9月)`;
    months = [
      `${fy}-10`, `${fy}-11`, `${fy}-12`,
      `${fy + 1}-01`, `${fy + 1}-02`, `${fy + 1}-03`,
      `${fy + 1}-04`, `${fy + 1}-05`, `${fy + 1}-06`,
      `${fy + 1}-07`, `${fy + 1}-08`, `${fy + 1}-09`
    ];
  }

  return { startDate, endDate, label, months };
}

/**
 * 完了見込み月 (YYYY-MM) から着地見込みQを判定
 */
function getQuarterFromYearMonth(yearMonthStr) {
  if (!yearMonthStr) return null;
  const match = yearMonthStr.match(/^(\d{4})[-/](\d{1,2})/);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);

  const testDate = new Date(y, m - 1, 15);
  const fiscalYear = getFiscalYear(testDate);
  const quarter = getFiscalQuarter(testDate);

  const qNum = quarter.replace('Q', '');
  return {
    fiscalYear,
    quarter,
    label: `${fiscalYear}年度 ${qNum}Q`
  };
}

/**
 * 選考案件が対象Qに含まれるかを判定する（優先順位に基づくロジック: 指示書 14項）
 */
function isSelectionInQuarter(selection, targetFiscalYear, targetQuarter) {
  if (!selection) return false;
  const fy = parseInt(targetFiscalYear, 10);

  // 1. 完了見込み月 (YYYY-MM)
  if (selection.expectedCompletionMonth) {
    const qInfo = getQuarterFromYearMonth(selection.expectedCompletionMonth);
    if (qInfo) {
      if (targetQuarter === 'ALL') return qInfo.fiscalYear === fy;
      return qInfo.fiscalYear === fy && qInfo.quarter === targetQuarter;
    }
  }

  // 2. 着地見込みQ (オブジェクトまたは文字列)
  if (selection.targetQuarter) {
    if (typeof selection.targetQuarter === 'object') {
      const qFY = parseInt(selection.targetQuarter.fiscalYear, 10);
      const qQ = selection.targetQuarter.quarter;
      if (targetQuarter === 'ALL') return qFY === fy;
      return qFY === fy && qQ === targetQuarter;
    }
    if (typeof selection.targetQuarter === 'string') {
      const match = selection.targetQuarter.match(/(\d{4}).*?(Q[1-4])/i);
      if (match) {
        const qFY = parseInt(match[1], 10);
        const qQ = match[2].toUpperCase();
        if (targetQuarter === 'ALL') return qFY === fy;
        return qFY === fy && qQ === targetQuarter;
      }
    }
  }

  // 3. 内定承諾予定月 / 入社予定日
  const targetDateStr = selection.expectedOfferMonth || selection.plannedJoinDate || selection.nextScheduleDate || selection.recommendationDate;
  if (targetDateStr) {
    const d = new Date(targetDateStr);
    if (!isNaN(d.getTime())) {
      const fYear = getFiscalYear(d);
      const fQ = getFiscalQuarter(d);
      if (targetQuarter === 'ALL') return fYear === fy;
      return fYear === fy && fQ === targetQuarter;
    }
  }

  return false;
}

/**
 * 重複を除外した候補者実人数（ヘッドカウント）の計算 (指示書 4, 7, 10, 17項)
 */
function calculateUniqueCandidatesCount(selections, includeEnded = false) {
  const targetSelections = includeEnded 
    ? selections 
    : selections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
  
  const uniqueCandidateIds = new Set(targetSelections.map(s => s.candidateId));
  return uniqueCandidateIds.size;
}

/**
 * 候補者ごとの案件数およびヨミ合計の算出 (指示書 17, 18項)
 */
function calculateCandidateYomiTotals(selections) {
  const result = new Map();

  selections.forEach(s => {
    // 選考終了および内定辞退は除外 (指示書 17項)
    if (s.phase === '選考終了' || s.phase === '内定辞退') return;

    const candId = s.candidateId;
    const current = result.get(candId) || {
      candidateId: candId,
      candidateName: s.candidateName,
      caId: s.caId || s.caConsultantId,
      caName: s.caName,
      selectionCount: 0,
      totalYomi: 0,
      selections: []
    };

    current.selectionCount += 1;
    current.totalYomi += Number(s.yomi || 0);
    current.selections.push(s);

    result.set(candId, current);
  });

  return Array.from(result.values()).map(item => ({
    ...item,
    totalYomi: Math.round(item.totalYomi * 100) / 100
  }));
}

/**
 * 選考アラート状態の取得 (型安全防御型実装 & 終了/辞退案件除外)
 */
function getSelectionAlerts(selection, todayOrComp = new Date(), candidateYomiTotals = []) {
  const alerts = [];

  let today = (todayOrComp instanceof Date && !isNaN(todayOrComp.getTime()))
    ? new Date(todayOrComp)
    : new Date();

  today.setHours(0, 0, 0, 0);

  if (!selection || selection.phase === '選考終了' || selection.phase === '内定辞退') return alerts;

  // 1. 次回予定日超過
  if (selection.nextScheduleDate) {
    const nextDate = new Date(selection.nextScheduleDate);
    if (!isNaN(nextDate.getTime()) && nextDate < today && selection.progressStatus !== '完了') {
      alerts.push({ type: 'expired_action', message: '次回予定日超過', level: 'red' });
    }
  }

  // 2. 結果待ち長期化 (7日以上)
  if (selection.progressStatus === '実施済み・結果待ち' && selection.phaseUpdatedAt) {
    const updatedAt = new Date(selection.phaseUpdatedAt);
    if (!isNaN(updatedAt.getTime())) {
      const diffDays = Math.floor((today - updatedAt) / (1000 * 60 * 60 * 24));
      if (diffDays >= 7) {
        alerts.push({ type: 'waiting_result_long', message: `結果待ち ${diffDays}日目`, level: 'red' });
      } else if (diffDays >= 3) {
        alerts.push({ type: 'waiting_result_medium', message: `結果待ち ${diffDays}日目`, level: 'amber' });
      }
    }
  }

  // 3. 企業対応期限超過
  if (selection.actionDeadline) {
    const dLine = new Date(selection.actionDeadline);
    if (!isNaN(dLine.getTime()) && dLine < today && selection.companyActionStatus !== '完了') {
      alerts.push({ type: 'action_deadline_over', message: '対応期限超過', level: 'red' });
    }
  }

  return alerts;
}


/**
 * 選考進捗・ヨミ管理システム - ソート ＆ フェーズ優先度判定ユーティリティ (指示書 1, 3, 5, 6項対応)
 */

/**
 * 選考フェーズの優先度スコアを取得 (表記ゆれ対応) (指示書 5, 6項)
 */
function getPhasePriorityScore(phaseInput) {
  if (!phaseInput) return 0;

  const phase = String(phaseInput).trim();

  // 1. 内定承諾 / 入社予定
  if (phase === '内定承諾') return 100;
  if (phase === '入社予定') return 95;

  // 2. 内定
  if (phase === '内定') return 90;

  // 3. オファー面談・条件提示 (表記ゆれ: オファー面談, 条件提示)
  if (phase === 'オファー面談・条件提示' || phase === 'オファー面談' || phase === '条件提示') return 80;

  // 4. 面接フェーズ (最終, 三次, 二次, 一次)
  if (phase === '最終面接' || phase === '最終') return 70;
  if (phase === '三次面接' || phase === '三次') return 65;
  if (phase === '二次面接' || phase === '二次') return 60;
  if (phase === '一次面接' || phase === '一次') return 50;

  // 5. 書類選考 (表記ゆれ: 書類選考中, 書類)
  if (phase === '書類選考' || phase === '書類選考中' || phase === '書類') return 40;

  // 6. 推薦準備
  if (phase === '推薦準備' || phase === '推薦') return 30;

  // 7. 終了系フェーズ
  if (phase === '内定辞退') return 10;
  if (phase === '選考終了') return 0;

  return 20; // その他
}

/**
 * 選考案件のマルチキーソート関数 (指示書 1, 2, 3項)
 */
function sortSelections(selections, sortBy = 'phase_desc') {
  const list = [...selections];

  return list.sort((a, b) => {
    const isEndedA = a.phase === '選考終了' || a.phase === '内定辞退';
    const isEndedB = b.phase === '選考終了' || b.phase === '内定辞退';

    // 進行中案件と終了案件が混在する場合、常に進行中案件を上部に表示 (指示書 2項)
    if (!isEndedA && isEndedB) return -1;
    if (isEndedA && !isEndedB) return 1;

    // 終了案件同士のソート (終了日の新しい順) (指示書 2項)
    if (isEndedA && isEndedB) {
      const dateA = a.phaseUpdatedAt || a.nextScheduleDate || '0000-00-00';
      const dateB = b.phaseUpdatedAt || b.nextScheduleDate || '0000-00-00';
      return dateB.localeCompare(dateA);
    }

    // 進行中案件の並び替え指定別の処理
    if (sortBy === 'phase_desc') {
      // 1. 選考フェーズ優先度スコア降順 (指示書 1, 5項)
      const scoreA = getPhasePriorityScore(a.phase);
      const scoreB = getPhasePriorityScore(b.phase);
      if (scoreA !== scoreB) return scoreB - scoreA;

      // 2. 同一フェーズ内のサブソート (指示書 3項)
      // ① 次回予定日が近い順 (未設定は後に表示)
      const dateA = a.nextScheduleDate ? a.nextScheduleDate : '9999-99-99';
      const dateB = b.nextScheduleDate ? b.nextScheduleDate : '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      // ② アクション期限が近い順
      const dlineA = a.actionDeadline ? a.actionDeadline : '9999-99-99';
      const dlineB = b.actionDeadline ? b.actionDeadline : '9999-99-99';
      if (dlineA !== dlineB) return dlineA.localeCompare(dlineB);

      // ③ 最終更新日の新しい順
      const updatedA = a.phaseUpdatedAt || a.recommendationDate || '0000-00-00';
      const updatedB = b.phaseUpdatedAt || b.recommendationDate || '0000-00-00';
      if (updatedA !== updatedB) return updatedB.localeCompare(updatedA);

      // ④ 候補者名の五十音順
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'nextDate_asc') {
      const dateA = a.nextScheduleDate ? a.nextScheduleDate : '9999-99-99';
      const dateB = b.nextScheduleDate ? b.nextScheduleDate : '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'updated_desc') {
      const updatedA = a.phaseUpdatedAt || a.recommendationDate || '0000-00-00';
      const updatedB = b.phaseUpdatedAt || b.recommendationDate || '0000-00-00';
      return updatedB.localeCompare(updatedA);
    }

    if (sortBy === 'yomi_desc') {
      const yomiA = Number(a.yomi || 0);
      const yomiB = Number(b.yomi || 0);
      if (yomiA !== yomiB) return yomiB - yomiA;
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'candName_asc') {
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    return 0;
  });
}


/**
 * 選考進捗・ヨミ管理システム - ホワイトボード用 5区分フェーズマッピング & RA対応計算ユーティリティ (指示書 5, 6, 7, 10, 15, 17, 18, 27項)
 */



/**
 * 実フェーズ文字列からホワイトボード5区分表示グループへのマッピング (指示書 6, 7, 30項)
 */
function getWhiteboardPhaseGroup(phaseInput) {
  if (!phaseInput) return '書類選考';

  const phase = phaseInput.trim();

  // 1. 内定承諾
  if (['内定承諾', '承諾', '入社予定', '入社日確定', '入社手続き中', '内定承諾後'].includes(phase)) {
    return '内定承諾';
  }

  // 2. 内定
  if (['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整中', '内定回答待ち', '候補者回答待ち', 'オファー面談調整中'].includes(phase)) {
    return '内定';
  }

  // 3. 最終・二次
  if (['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接', '二次面接以降', '最終面接前面談', '最終'].includes(phase)) {
    return '最終・二次';
  }

  // 4. 一次
  if (['一次面接', '一次選考', '一次面談', 'カジュアル面談', '一次面接日程調整', '一次面接結果待ち', '一次'].includes(phase)) {
    return '一次';
  }

  // 5. 書類選考
  if (['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち', '企業推薦前確認', '書類'].includes(phase)) {
    return '書類選考';
  }

  // 表記ゆれ判定
  if (phase.includes('最終') || phase.includes('二次') || phase.includes('三次')) return '最終・二次';
  if (phase.includes('一次') || phase.includes('面談')) return '一次';
  if (phase.includes('オファー') || phase.includes('条件') || phase.includes('内定')) return '内定';
  if (phase.includes('承諾') || phase.includes('入社')) return '内定承諾';

  return '書類選考';
}

/**
 * 営業日加算ユーティリティ (土日スキップ) (指示書 15, 19項)
 */
function addBusinessDays(startDateInput, daysToAdd) {
  let date = new Date(startDateInput || new Date());
  let added = 0;
  while (added < daysToAdd) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0:日, 6:土
      added++;
    }
  }
  return date;
}

/**
 * CAが選考フェーズ・進行状態を更新した際の RA企業対応項目 自動連動判定ロジック (指示書 5, 6, 7, 11, 15, 18, 27項)
 */
function deriveCompanyActionFromSelection({ phase, progressStatus, recommendationDate, nextScheduleDate, currentCompanyAction = {} }) {
  const p = phase || '書類選考';
  const s = progressStatus || '未対応';
  const today = new Date();

  let type = '要確認';
  let status = '未対応';
  let confirmationItem = '';
  let nextAction = '要確認';
  let nextActionTarget = '企業';
  let suggestedDeadlineDays = 2;

  // 1. 選考終了・辞退・見送り案件の自動処理 (指示書 6項)
  if (p === '選考終了' || p === '内定辞退' || s === '不通過' || s === '候補者辞退' || s === '企業都合終了') {
    return {
      companyActionType: '対応不要',
      companyActionStatus: '対応完了',
      companyConfirmationItem: '',
      nextAction: '対応完了',
      nextActionTarget: '対応不要',
      actionDeadline: null,
      nextCompanyContactDate: null,
      shouldAppearInRaToday: false
    };
  }

  // 2. 内定承諾
  if (p === '内定承諾' || p === '入社予定') {
    type = '入社手続きの確認';
    status = '未対応';
    confirmationItem = '入社日・入社手続きのご確認';
    nextAction = '企業へ入社日・入社手続きを確認';
    nextActionTarget = '企業';
    suggestedDeadlineDays = 3;
  }
  // 3. 内定・オファー面談・条件提示
  else if (p === '内定' || p === 'オファー面談・条件提示' || p === '条件提示') {
    if (s === '日程調整中') {
      type = 'オファー面談日程の確認';
      status = '未対応';
      confirmationItem = 'オファー面談日程のご確認';
      nextAction = '企業へオファー面談日を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else if (s === '条件確認中' || s === '条件提示中') {
      type = '条件内容の確認';
      status = '未対応';
      confirmationItem = '提示条件および回答期限のご確認';
      nextAction = '企業へ条件内容・回答期限を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 3;
    } else if (s === '候補者回答待ち' || s === '未対応') {
      type = '候補者意向の確認';
      status = 'CA確認待ち';
      confirmationItem = currentCompanyAction.companyConfirmationItem || '候補者の選考意向・回答期限のご確認';
      nextAction = 'CAへ候補者の意向を確認';
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else {
      type = 'オファー面談・条件提示の確認';
      status = '未対応';
      confirmationItem = 'オファー面談・条件提示進捗のご確認';
      nextAction = '企業へオファー面談・条件提示進捗を確認';
      nextActionTarget = '企業';
    }
  }
  // 4. 面接（最終・三次・二次・一次）
  else if (p.includes('面接')) {
    const isFinal = p.includes('最終');
    const isSecond = p.includes('二次');
    const isThird = p.includes('三次');

    const prefix = isFinal ? '最終面接' : (isThird ? '三次面接' : (isSecond ? '二次面接' : '一次面接'));

    if (s === '日程調整中') {
      type = '面接日程の確認';
      status = '未対応';
      confirmationItem = `${prefix}日程のご確認`;
      nextAction = `企業へ${prefix}日程を確認`;
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else if (s === '候補者日程待ち') {
      type = '候補者日程の確認';
      status = 'CA確認待ち';
      confirmationItem = currentCompanyAction.companyConfirmationItem || `${prefix}の候補者様候補日確認`;
      nextAction = `CAへ候補者の${prefix}候補日を確認`;
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else if (s === '実施済み・結果待ち' || s === '未対応') {
      type = '面接結果の確認';
      status = '未対応';
      confirmationItem = `${prefix}結果のご確認`;
      nextAction = `企業へ${prefix}結果を確認`;
      nextActionTarget = '企業';
      suggestedDeadlineDays = 2;
    } else {
      type = '面接進捗の確認';
      status = '未対応';
      confirmationItem = `${prefix}進捗のご確認`;
      nextAction = `企業へ${prefix}進捗を確認`;
      nextActionTarget = '企業';
    }
  }
  // 5. 書類選考
  else if (p === '書類選考' || p === '推薦準備') {
    if (p === '推薦準備') {
      type = '推薦書類の確認';
      status = 'CA確認待ち';
      confirmationItem = '推薦書類のご準備・推薦状況のご確認';
      nextAction = 'CAへ推薦書類の状況を確認';
      nextActionTarget = 'CA';
      suggestedDeadlineDays = 1;
    } else {
      type = '書類選考結果の確認';
      status = '未対応';
      confirmationItem = '書類選考結果のご確認';
      nextAction = '企業へ書類選考結果を確認';
      nextActionTarget = '企業';
      suggestedDeadlineDays = 3;
    }
  }

  const calculatedDeadline = addBusinessDays(today, suggestedDeadlineDays).toISOString().slice(0, 10);

  return {
    companyActionType: type,
    companyActionStatus: status,
    companyConfirmationItem: confirmationItem,
    nextAction,
    nextActionTarget,
    actionDeadline: calculatedDeadline,
    nextCompanyContactDate: calculatedDeadline,
    companyActionSource: 'auto',
    shouldAppearInRaToday: (status === '未対応' || status === 'CA確認待ち')
  };
}

/**
 * フェーズと進行状態からの「次の対応」および「対応先」自動判定
 */
function autoDetectNextAction(selection) {
  if (!selection) return { action: '要確認', target: '社内' };

  if (selection.nextAction && selection.nextActionTarget) {
    return { action: selection.nextAction, target: selection.nextActionTarget };
  }

  const derived = deriveCompanyActionFromSelection({
    phase: selection.phase,
    progressStatus: selection.progressStatus,
    currentCompanyAction: selection
  });

  return {
    action: derived.nextAction,
    target: derived.nextActionTarget
  };
}

/**
 * 基準日からの経過日数の計算
 */
function calculateElapsedTime(selection, todayInput = new Date()) {
  const today = new Date(todayInput);
  today.setHours(0, 0, 0, 0);

  const phase = selection.phase || '';
  let baseDate = null;
  let label = '経過';

  if (phase === '書類選考') {
    if (selection.recommendationDate) {
      baseDate = new Date(selection.recommendationDate);
      label = '書類提出後';
    }
  } else if (phase.includes('面接')) {
    if (selection.nextScheduleDate && new Date(selection.nextScheduleDate) <= today) {
      baseDate = new Date(selection.nextScheduleDate);
      label = '面接実施後';
    }
  }

  if (!baseDate && selection.phaseUpdatedAt) {
    baseDate = new Date(selection.phaseUpdatedAt);
    label = 'フェーズ変更後';
  }

  if (!baseDate) {
    return { days: 0, label: '経過', text: '経過: -' };
  }

  baseDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - baseDate.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  return {
    days: diffDays,
    label,
    text: `${label}：${diffDays}日`
  };
}

/**
 * 対応期限の確定
 */
function getEffectiveDeadline(selection, todayInput = new Date()) {
  if (selection.actionDeadline) return new Date(selection.actionDeadline);
  if (selection.nextCompanyContactDate) return new Date(selection.nextCompanyContactDate);
  if (selection.nextScheduleDate) return new Date(selection.nextScheduleDate);

  const today = new Date(todayInput);
  return addBusinessDays(today, 2);
}

/**
 * 緊急度の判定
 */
function calculateUrgency(selection, todayInput = new Date()) {
  if (selection.phase === '内定辞退') return URGENCY_LEVELS.DECLINED;
  if (selection.phase === '選考終了') return URGENCY_LEVELS.NONE;
  if (selection.companyActionStatus === '完了' || selection.companyActionStatus === '対応完了' || selection.progressStatus === '完了') return URGENCY_LEVELS.NONE;

  const today = new Date(todayInput);
  today.setHours(0, 0, 0, 0);

  const deadline = getEffectiveDeadline(selection, today);
  deadline.setHours(0, 0, 0, 0);

  const diffTime = deadline.getTime() - today.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return URGENCY_LEVELS.EXPIRED;
  if (diffDays === 0) return URGENCY_LEVELS.TODAY;

  if (selection.companyActionStatus === '回答待ち') return URGENCY_LEVELS.WAITING_REPLY;
  if (selection.nextActionTarget === 'CA' || selection.companyActionStatus === 'CA確認待ち') return URGENCY_LEVELS.CA_CHECK;
  if (diffDays >= 1 && diffDays <= 3) return URGENCY_LEVELS.WITHIN_3DAYS;

  return URGENCY_LEVELS.NONE;
}


/**
 * 選考進捗・ヨミ管理システム - 企業向け CSV・Excel エクスポートユーティリティ (社内情報完全除外 ＆ 企業提出成形対応)
 */



/**
 * 企業向けエクスポートデータの生成 (非公開情報を徹底除外) (指示書 15項)
 */
function buildCompanyExportRows(company, selections) {
  const candidates = store.getCandidates();
  const jobs = store.getJobs();

  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
  const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

  return selections.map((sel, idx) => {
    const candidate = candidatesMap.get(sel.candidateId);
    const job = jobsMap.get(sel.jobId);

    // フェーズ・状態に応じた日付の動的決定 (指示書 13項)
    const dateStr = sel.nextScheduleDate || sel.recommendationDate || (sel.phaseUpdatedAt ? sel.phaseUpdatedAt.split('T')[0] : '');

    return {
      'No.': idx + 1,
      '候補者名': (candidate ? candidate.name : sel.candidateName) + ' 様',
      '応募ポジション': job ? (job.title || job.jobName) : sel.jobName,
      '推薦日/提出日': sel.recommendationDate || '',
      '現在の選考状況': `${sel.phase} (${sel.progressStatus})`,
      '面接予定日/実施日': dateStr,
      '企業への確認事項': sel.companyConfirmationItem || sel.companyCheckItems || '選考結果のご確認',
      '企業共有コメント': sel.companySharedComment || '',
      '企業回答': '',      // 人事記入欄
      '回答日': '',        // 人事記入欄
      '次回選考希望': '',   // 人事記入欄
      '備考・コメント': '' // 人事記入欄
    };
  });
}

/**
 * UTF-8 BOM付き CSV ダウンロード処理 (指示書 16, 28項)
 */
function exportCompanyToCsv(company, selections, filename) {
  const rows = buildCompanyExportRows(company, selections);
  if (!rows || rows.length === 0) {
    alert('出力対象の選考案件が存在しません。');
    return;
  }

  const headers = Object.keys(rows[0]);
  
  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += headers.map(escapeCSV).join(',') + '\r\n';

  rows.forEach(row => {
    const line = headers.map(h => escapeCSV(row[h])).join(',');
    csvContent += line + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * SheetJS (XLSX) を利用した 企業向け Excel (.xlsx) ダウンロード処理 (指示書 17, 28項)
 */
function exportCompanyToExcel(company, selections, filename) {
  const rows = buildCompanyExportRows(company, selections);
  if (!rows || rows.length === 0) {
    alert('出力対象の選考案件が存在しません。');
    return;
  }

  if (typeof XLSX === 'undefined') {
    console.warn('XLSX library not loaded, falling back to CSV export.');
    exportCompanyToCsv(company, selections, filename.replace(/\.xlsx$/i, '.csv'));
    return;
  }

  const consultants = store.getConsultants();
  const raCons = consultants.find(c => c.consultantId === (company.primaryRaId || company.raConsultantId));

  // ヘッダー概要情報行の構築 (指示書 17項)
  const headerInfo = [
    { 'No.': `${company.name} 御中`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `資料名: 選考進捗確認資料`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `作成日: ${new Date().toLocaleDateString('ja-JP')}`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `担当: 株式会社サンクスパートナーズ (${raCons ? raCons.name : '担当RA'})`, '候補者名': '', '応募ポジション': '' },
    { 'No.': `対象件数: ${selections.length}件`, '候補者名': '', '応募ポジション': '' },
    { 'No.': '', '候補者名': '', '応募ポジション': '' } // 空白行
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows, { origin: 'A7' });

  // 概要情報を書き込み
  XLSX.utils.sheet_add_json(worksheet, headerInfo, { skipHeader: true, origin: 'A1' });

  // 列幅自動調整 (指示書 17項)
  const colWidths = [
    { wch: 6 },  // No.
    { wch: 18 }, // 候補者名
    { wch: 24 }, // 応募ポジション
    { wch: 14 }, // 推薦日
    { wch: 22 }, // 現在の選考状況
    { wch: 18 }, // 面接予定日
    { wch: 28 }, // 確認事項
    { wch: 30 }, // 共有コメント
    { wch: 20 }, // 企業回答
    { wch: 14 }, // 回答日
    { wch: 18 }, // 次回選考希望
    { wch: 24 }  // コメント
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '選考進捗確認資料');

  const finalFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalFilename);
}


/**
 * 選考進捗・ヨミ管理システム - メールテンプレート & 自動生成ユーティリティ (選択候補者自動反映対応)
 */

/**
 * 日付フォーマット変換 (YYYY-MM-DD -> YYYY年M月D日) (指示書 14項)
 */
function formatJapaneseDate(dateStr) {
  if (!dateStr) return null;
  // ISO形式やYYYY-MM-DD形式の解析
  const match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    return `${year}年${month}月${day}日`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return null;
}

/**
 * 候補者名と敬称「様」の正規化 (指示書 5項)
 */
function normalizeCandidateName(name) {
  if (!name) return '候補者 様';
  let cleaned = name.trim().replace(/\s*様\s*$/g, '').trim();
  return `${cleaned} 様`;
}

/**
 * フェーズ＆進行状態に応じた初期確認事項の補完 (指示書 10項)
 */
function getConfirmationItem(selection) {
  const customItem = selection.companyConfirmationItem || selection.companyCheckItems || selection.companySharedComment;
  if (customItem && customItem.trim()) {
    return customItem.trim();
  }

  const phase = selection.phase || '';
  const status = selection.progressStatus || '';

  if (phase === '書類選考') {
    return '書類選考結果のご確認';
  }
  if (phase.includes('面接')) {
    if (status === '調整中' || status === '未対応') {
      return '面接日程のご確認';
    }
    if (status === '実施済み・結果待ち' || status === '実施済み' || status === '結果待ち') {
      return '面接結果のご確認';
    }
    return '選考進捗のご確認';
  }
  if (phase === 'オファー面談・条件提示' || phase === '内定') {
    if (status === '保留') return '進捗のご確認';
    return '内定条件および今後の進行についてのご確認';
  }
  if (phase === '内定承諾' || phase === '入社予定') {
    return '入社手続きおよび受け入れ準備のご確認';
  }

  return '進捗のご確認';
}

/**
 * フェーズ＆進行状態に応じた動的日付項目名と日本語日付の取得 (指示書 6項, 7項)
 */
function getDateInfoForSelection(selection, histories = []) {
  const phase = selection.phase || '';
  const status = selection.progressStatus || '';

  // 1. 書類選考
  if (phase === '書類選考' || phase === '推薦準備') {
    const rawDate = selection.submissionDate || selection.recommendationDate || selection.createdAt;
    const formatted = formatJapaneseDate(rawDate);
    return formatted ? { label: '書類提出日', value: formatted } : null;
  }

  // 2. 一次〜最終面接
  if (phase.includes('面接')) {
    const isBeforeInterview = status === '調整中' || status === '日程確定' || status === '未対応' || status === '実施前';
    const rawDate = selection.nextScheduleDate || selection.interviewDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(rawDate);
    
    if (isBeforeInterview) {
      return formatted ? { label: '面接予定日', value: formatted } : null;
    } else {
      return formatted ? { label: '面接実施日', value: formatted } : null;
    }
  }

  // 3. オファー面談・条件提示
  if (phase === 'オファー面談・条件提示') {
    const rawDate = selection.nextScheduleDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(rawDate);
    const isPast = rawDate && new Date(rawDate) <= new Date();

    if (status === '条件提示のみ') {
      return formatted ? { label: '条件提示日', value: formatted } : null;
    }
    if (isPast || status === '実施済み' || status === '通過' || status === '保留') {
      return formatted ? { label: '面談実施日', value: formatted } : null;
    } else {
      return formatted ? { label: '面談予定日', value: formatted } : null;
    }
  }

  // 4. 内定
  if (phase === '内定') {
    // 履歴から探すか、phaseUpdatedAt
    const noticeDate = selection.offerNoticeDate || selection.phaseUpdatedAt || selection.createdAt;
    const formatted = formatJapaneseDate(noticeDate);
    return formatted ? { label: '内定通知日', value: formatted } : null;
  }

  // 5. 内定承諾 / 入社予定
  if (phase === '内定承諾' || phase === '入社予定') {
    const acceptDate = selection.acceptanceDate || selection.selectionEndDate || selection.phaseUpdatedAt;
    const formatted = formatJapaneseDate(acceptDate);
    return formatted ? { label: '内定承諾日', value: formatted } : null;
  }

  // デフォルト: 次回予定日
  const rawDate = selection.nextScheduleDate;
  const formatted = formatJapaneseDate(rawDate);
  return formatted ? { label: '次回予定日', value: formatted } : null;
}

/**
 * 選択された全選考案件から {{候補者一覧}} 差し込みテキストを一括自動生成 (指示書 2, 3, 4, 5, 6, 7, 8, 9, 10項)
 */
function buildCandidateListEmailText(selections, candidatesMap, jobsMap, historiesList = []) {
  if (!selections || selections.length === 0) {
    return '（対象の選考案件が選択されていません）';
  }

  let hasMissingDate = false;

  const itemsText = selections.map((s, idx) => {
    const cand = candidatesMap.get(s.candidateId);
    const job = jobsMap.get(s.jobId);

    const candNameFormatted = normalizeCandidateName(cand ? cand.name : s.candidateName);
    const jobTitleFormatted = job ? job.title : s.jobName || '全般';

    // 現在の選考状況：フェーズ（進行状態） (指示書 4項)
    let statusText = s.phase || '';
    if (s.progressStatus && s.progressStatus !== '未対応' && s.progressStatus !== '未登録' && s.progressStatus.trim() !== '') {
      statusText += `（${s.progressStatus}）`;
    }

    // フェーズ対応の日付 (指示書 6項, 7項)
    const dateInfo = getDateInfoForSelection(s, historiesList);
    if (!dateInfo) {
      hasMissingDate = true;
    }

    // 確認事項 (指示書 10項)
    const confirmItem = getConfirmationItem(s);

    let text = `${idx + 1}．${candNameFormatted}\n`;
    text += `  応募ポジション：${jobTitleFormatted}\n`;
    text += `  現在の選考状況：${statusText}\n`;
    if (dateInfo) {
      text += `  ${dateInfo.label}：${dateInfo.value}\n`;
    }
    text += `  確認事項：${confirmItem}`;

    return text;
  }).join('\n\n'); // 空行1行を挟む (指示書 8項)

  return {
    text: itemsText,
    hasMissingDate
  };
}

/**
 * クリップボードへの文字列コピー
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      return successful;
    }
  } catch (err) {
    console.error('Copy failed', err);
    return false;
  }
}

/**
 * 簡易確認メール文面自動生成 (旧機能維持用)
 */
function generateCheckEmailTemplate(companyName, contactName, raName, inProgressCount) {
  const contactStr = contactName ? `${contactName}様` : 'ご担当者様';

  return `${companyName}
${contactStr}

いつも大変お世話になっております。
株式会社サンクスパートナーズの${raName}でございます。

現在、貴社にて進行中の選考案件（全${inProgressCount}名）につきまして、
最新の選考状況および面接結果のご確認のためご連絡いたしました。

お忙しいところ恐縮ではございますが、ご高覧いただけますと幸いでございます。
何卒よろしくお願い申し上げます。`;
}


/**
 * 選考進捗・ヨミ管理システム - スプレッドシートCSV一括取込・名寄せ・プレビューユーティリティ
 */



function parseCSVText(csvText) {
  const lines = csvText.split(/\r\n|\n|\r/);
  const result = [];

  let currentLine = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i++; // スキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentLine.push(currentValue.trim());
      if (currentLine.some(cell => cell.length > 0)) {
        result.push(currentLine);
      }
      currentLine = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentLine.length > 0) {
    currentLine.push(currentValue.trim());
    if (currentLine.some(cell => cell.length > 0)) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * CSVデータの解析と検証・プレビュー生成
 */
function analyzeImportCSV(csvRows, autoCreateMasters = true) {
  if (!csvRows || csvRows.length < 2) {
    return { error: 'CSVにヘッダー行およびデータ行が存在しません。' };
  }

  const headers = csvRows[0].map(h => h.replace(/^\uFEFF/, '').trim());
  const dataRows = csvRows.slice(1);

  const getColIndex = (name) => headers.findIndex(h => h.includes(name));

  const idxCand = getColIndex('候補者');
  const idxComp = getColIndex('企業');
  const idxJob = getColIndex('求人') !== -1 ? getColIndex('求人') : getColIndex('ポジション');
  const idxCA = getColIndex('CA');
  const idxRA = getColIndex('RA');
  const idxPhase = getColIndex('フェーズ');
  const idxStatus = getColIndex('進行状態');
  const idxMonth = getColIndex('完了見込み月');
  const idxYomi = getColIndex('ヨミ');
  const idxDate = getColIndex('次回予定日');
  const idxMemo = getColIndex('備考');

  if (idxCand === -1 || idxComp === -1) {
    return { error: '必須項目「候補者名」「企業名」のヘッダーが見つかりません。' };
  }

  const existingConsultants = store.getConsultants();
  const existingCompanies = store.getCompanies();
  const existingJobs = store.getJobs();
  const existingCandidates = store.getCandidates();
  const existingSelections = store.getSelections();

  const previewItems = [];
  let newCount = 0;
  let updateCount = 0;
  let errorCount = 0;

  dataRows.forEach((row, rowIndex) => {
    const lineNum = rowIndex + 2;
    const candName = row[idxCand] || '';
    const compName = row[idxComp] || '';
    const jobTitle = idxJob !== -1 ? row[idxJob] : '総合職・標準ポジション';
    const caName = idxCA !== -1 ? row[idxCA] : '';
    const raName = idxRA !== -1 ? row[idxRA] : '';
    const phase = idxPhase !== -1 ? row[idxPhase] : '書類選考';
    const status = idxStatus !== -1 ? row[idxStatus] : '未対応';
    const month = idxMonth !== -1 ? row[idxMonth] : '';
    const yomiRaw = idxYomi !== -1 ? row[idxYomi] : '';
    const nextDate = idxDate !== -1 ? row[idxDate] : '';
    const memo = idxMemo !== -1 ? row[idxMemo] : '';

    const rowErrors = [];

    if (!candName) rowErrors.push('候補者名が空欄です');
    if (!compName) rowErrors.push('企業名が空欄です');

    // ヨミの数値変換
    let yomiVal = 0.25;
    if (yomiRaw.includes('0%')) yomiVal = 0;
    else if (yomiRaw.includes('25%')) yomiVal = 0.25;
    else if (yomiRaw.includes('50%')) yomiVal = 0.5;
    else if (yomiRaw.includes('75%')) yomiVal = 0.75;
    else if (yomiRaw.includes('100%')) yomiVal = 1.0;

    // マスタ存在判定
    const candMatch = existingCandidates.find(c => c.name === candName);
    const compMatch = existingCompanies.find(c => c.name === compName);
    const jobMatch = compMatch ? existingJobs.find(j => j.companyId === compMatch.companyId && j.title === jobTitle) : null;
    const caMatch = existingConsultants.find(c => c.name === caName);
    const raMatch = existingConsultants.find(c => c.name === raName);

    if (!autoCreateMasters) {
      if (!candMatch) rowErrors.push(`候補者マスタ未存在: ${candName}`);
      if (!compMatch) rowErrors.push(`企業マスタ未存在: ${compName}`);
    }

    // 重複判定（候補者 + 企業 + 求人）
    let isUpdate = false;
    if (candMatch && compMatch && jobMatch) {
      const existsSel = existingSelections.find(s => 
        s.candidateId === candMatch.candidateId &&
        s.companyId === compMatch.companyId &&
        s.jobId === jobMatch.jobId
      );
      if (existsSel) isUpdate = true;
    }

    if (rowErrors.length > 0) {
      errorCount++;
    } else if (isUpdate) {
      updateCount++;
    } else {
      newCount++;
    }

    previewItems.push({
      lineNum,
      candName,
      compName,
      jobTitle,
      caName,
      raName,
      phase,
      status,
      yomiVal,
      month,
      nextDate,
      memo,
      isUpdate,
      hasError: rowErrors.length > 0,
      errors: rowErrors
    });
  });

  return {
    totalRows: dataRows.length,
    newCount,
    updateCount,
    errorCount,
    items: previewItems
  };
}

/**
 * プレビュー完了後の実際のインポート実行処理
 */
function executeImport(previewItems, autoCreateMasters = true) {
  let importedCount = 0;

  previewItems.forEach(item => {
    if (item.hasError) return;

    // 1. 候補者マスタ確保
    let candidate = store.getCandidates().find(c => c.name === item.candName);
    if (!candidate && autoCreateMasters) {
      candidate = store.saveCandidate({
        name: item.candName,
        kana: item.candName,
        caConsultantId: store.getConsultants()[0].consultantId,
        activityStatus: '選考中',
        internalManagementNumber: 'IMP-' + Date.now().toString().substr(6),
        remarks: 'CSV一括取り込みにより作成'
      });
      candidate = store.getCandidates().find(c => c.name === item.candName);
    }

    // 2. 企業マスタ確保
    let company = store.getCompanies().find(c => c.name === item.compName);
    if (!company && autoCreateMasters) {
      company = store.saveCompany({
        name: item.compName,
        kana: item.compName,
        raConsultantId: store.getConsultants()[0].consultantId,
        rank: '通常',
        checkIntervalDays: 3,
        remarks: 'CSV一括取り込みにより作成'
      });
      company = store.getCompanies().find(c => c.name === item.compName);
    }

    // 3. 求人マスタ確保
    let job = company ? store.getJobs(false, company.companyId).find(j => j.title === item.jobTitle) : null;
    if (!job && company && autoCreateMasters) {
      job = store.saveJob({
        companyId: company.companyId,
        title: item.jobTitle,
        status: '募集中',
        raConsultantId: company.raConsultantId
      });
      job = store.getJobs(false, company.companyId).find(j => j.title === item.jobTitle);
    }

    if (!candidate || !company || !job) return;

    // 4. コンサルタント取得
    const ca = store.getConsultants().find(c => c.name === item.caName) || store.getConsultants()[0];
    const ra = store.getConsultants().find(c => c.name === item.raName) || store.getConsultants()[0];

    // 5. 選考案件の登録・更新
    const existing = store.getSelections().find(s => 
      s.candidateId === candidate.candidateId &&
      s.companyId === company.companyId &&
      s.jobId === job.jobId
    );

    if (existing) {
      store.updateSelection(existing.selectionId, {
        phase: item.phase,
        progressStatus: item.status,
        yomi: item.yomiVal,
        expectedCompletionMonth: item.month || existing.expectedCompletionMonth,
        nextScheduleDate: item.nextDate || existing.nextScheduleDate,
        internalMemo: item.memo ? `${existing.internalMemo}\n[取り込み備考] ${item.memo}` : existing.internalMemo
      }, 'CSV一括取り込みによる更新');
    } else {
      store.addSelection({
        candidateId: candidate.candidateId,
        companyId: company.companyId,
        jobId: job.jobId,
        caConsultantId: ca.consultantId,
        raConsultantId: ra.consultantId,
        phase: item.phase,
        progressStatus: item.status,
        yomi: item.yomiVal,
        expectedCompletionMonth: item.month,
        nextScheduleDate: item.nextDate,
        internalMemo: item.memo
      });
    }

    importedCount++;
  });

  return importedCount;
}


/**
 * 選考進捗・ヨミ管理システム - ヘッダーコンポーネント
 */



function renderHeader(container, { onOpenNewSelection, onOpenCsvImport, activeViewTitle }) {
  const consultants = store.getConsultants();
  const currentCons = store.getCurrentConsultant();
  const currentRole = store.getCurrentRole();

  container.innerHTML = `
    <header class="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div class="px-6 py-3 flex items-center justify-between flex-wrap gap-4">
        <!-- ロゴ & タイトル -->
        <div class="flex items-center space-x-3">
          <div class="bg-indigo-600 p-2 rounded-lg text-white shadow-inner flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
            </svg>
          </div>
          <div>
            <h1 class="text-lg font-bold tracking-wide flex items-center gap-2">
              選考進捗・ヨミ管理システム
              <span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded border border-indigo-400/30">サンクスパートナーズ</span>
            </h1>
            <p class="text-xs text-slate-400">${activeViewTitle || '企業対応'}</p>
          </div>
        </div>

        <!-- アクション & 操作ユーザー/権限切り替え -->
        <div class="flex items-center space-x-4 flex-wrap gap-y-2">
          <!-- 新規選考案件登録ボタン -->
          <button id="header-btn-new-selection" class="inline-flex items-center px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-md shadow transition">
            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            新規選考案件を登録
          </button>

          <!-- CSV一括取込ボタン -->
          ${currentRole === 'admin' ? `
            <button id="header-btn-csv-import" class="inline-flex items-center px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md border border-slate-700 transition">
              <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
              </svg>
              CSV一括取込
            </button>
          ` : ''}

          <div class="h-5 w-px bg-slate-700 mx-1 hidden sm:block"></div>

          <!-- 操作ユーザー切り替え -->
          <div class="flex items-center space-x-2 bg-slate-800 px-3 py-1 rounded-md border border-slate-700 text-xs">
            <span class="text-slate-400">操作担当:</span>
            <select id="header-select-user" class="bg-transparent text-white font-medium focus:outline-none cursor-pointer">
              ${consultants.map(c => `
                <option value="${c.consultantId}" class="bg-slate-900 text-white" ${c.consultantId === currentCons?.consultantId ? 'selected' : ''}>
                  ${c.name} (${c.role === 'admin' ? '管理者' : '一般'})
                </option>
              `).join('')}
            </select>
          </div>

          <!-- 権限シミュレーション切り替え -->
          <div class="flex items-center space-x-1 bg-slate-800 p-1 rounded-md border border-slate-700 text-xs">
            <button id="btn-role-admin" class="px-2 py-0.5 rounded ${currentRole === 'admin' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'}">
              管理者
            </button>
            <button id="btn-role-member" class="px-2 py-0.5 rounded ${currentRole === 'member' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'}">
              一般
            </button>
          </div>

          <!-- 初期化ボタン -->
          <button id="header-btn-reset" class="text-slate-400 hover:text-slate-200 text-xs underline px-1" title="データを初期状態に戻す">
            データ初期化
          </button>
        </div>
      </div>
    </header>
  `;

  // イベントバインド
  container.querySelector('#header-btn-new-selection')?.addEventListener('click', onOpenNewSelection);
  container.querySelector('#header-btn-csv-import')?.addEventListener('click', onOpenCsvImport);

  container.querySelector('#header-select-user')?.addEventListener('change', (e) => {
    store.setCurrentUser(e.target.value);
  });

  container.querySelector('#btn-role-admin')?.addEventListener('click', () => {
    store.setCurrentRole('admin');
  });

  container.querySelector('#btn-role-member')?.addEventListener('click', () => {
    store.setCurrentRole('member');
  });

  container.querySelector('#header-btn-reset')?.addEventListener('click', () => {
    if (confirm('すべてのデータ・履歴をデモ初期状態に戻しますか？')) {
      store.resetToDefaults();
    }
  });
}


/**
 * 選考進捗・ヨミ管理システム - サイドバーナビゲーションコンポーネント (タイトル簡略化統一版)
 */

const VIEWS = {
  DASHBOARD: 'dashboard',
  SELECTIONS: 'selections',
  KANBAN: 'kanban',
  CA: 'ca',
  RA: 'ra',
  COMPANY_ACTIONS: 'company_actions',
  CONSULTANTS: 'consultants',
  COMPANIES: 'companies',
  JOBS: 'jobs',
  MASTERS: 'masters'
};

function renderSidebar(container, activeView, onSelectView) {
  const menuItems = [
    {
      id: VIEWS.COMPANY_ACTIONS,
      title: '企業対応',
      icon: `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>`
    },
    {
      id: VIEWS.KANBAN,
      title: 'ホワイトボード',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>`
    },
    {
      id: VIEWS.COMPANIES,
      title: '企業別提出',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`
    },

    {
      id: VIEWS.JOBS,
      title: '求人・ポジション別',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`
    },
    {
      id: VIEWS.MASTERS,
      title: 'マスタ管理',
      icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`
    }
  ];

  container.innerHTML = `
    <aside class="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex-shrink-0 min-h-screen py-4 hidden md:block">
      <div class="px-4 mb-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">メインメニュー</p>
      </div>
      <nav class="space-y-1 px-2">
        ${menuItems.map(item => `
          <button
            data-view-id="${item.id}"
            class="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
              activeView === item.id
                ? 'bg-indigo-600/90 text-white font-semibold shadow-sm'
                : 'hover:bg-slate-800 hover:text-white text-slate-400'
            }"
          >
            <span class="${activeView === item.id ? 'text-white' : 'text-slate-400'}">${item.icon}</span>
            <span>${item.title}</span>
          </button>
        `).join('')}
      </nav>
    </aside>
  `;

  container.querySelectorAll('button[data-view-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.getAttribute('data-view-id');
      onSelectView(viewId);
    });
  });
}





const DASHBOARD_STORAGE_KEY = 'dashboard_active_quarter_v2';

function getSavedDashboardState() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveDashboardState(state) {
  try {
    const current = getSavedDashboardState();
    sessionStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderDashboard(container, { onOpenDetail, onNavigateToSelections, onNavigateToConsultant, onNavigateToCompany }) {
  const savedState = getSavedDashboardState();

  const currentInitialFQ = getFiscalQuarterFromDate(new Date());

  let selectedFiscalYear = savedState.fiscalYear !== undefined ? parseInt(savedState.fiscalYear, 10) : currentInitialFQ.fiscalYear;
  let selectedQuarter = savedState.quarter !== undefined ? savedState.quarter : currentInitialFQ.quarter;
  
  // 初期表示は必ず「チーム全体」とする (指示書 3, 8, 10, 5項)
  let selectedConsultantId = savedState.consultantId !== undefined ? savedState.consultantId : 'ALL';
  let activeRoleType = savedState.roleType !== undefined ? savedState.roleType : 'CA'; // 'CA' | 'RA'
  let searchKeyword = savedState.searchKeyword || '';
  let activeBallFilter = savedState.activeBallFilter || 'ALL'; // 'ALL' | 'CA' | 'RA' | 'OVERDUE' | 'COMPANY'
  let showAllInProgress = savedState.showAllInProgress !== undefined ? savedState.showAllInProgress : false; // Step 20

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const companies = store.getCompanies();
    const jobs = store.getJobs();

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const qTargetMap = new Map(qTargets.map(t => [t.consultantId, Number(t.targetCount || 0)]));

    // 有効な CA・兼任コンサルタントを抽出
    const activeCaConsultants = consultants.filter(c => {
      if (c.isArchived || c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
      return c.roleType === 'CA' || c.roleType === 'ADMIN';
    });

    // チームQ目標 ＝ 対象QのCA個人目標の合計
    let teamQTarget = activeCaConsultants.reduce((sum, c) => sum + (qTargetMap.get(c.consultantId) || 0), 0);
    if (teamQTarget === 0) teamQTarget = qTargetMap.get('TEAM') || 13;

    // 担当者フィルターに基づく案件フィルタリング
    const filteredSelections = selections.filter(s => {
      if (s.isArchived) return false;
      if (selectedConsultantId === 'ALL') return true;

      return activeRoleType === 'CA'
        ? (s.caId === selectedConsultantId || s.caConsultantId === selectedConsultantId)
        : (s.raId === selectedConsultantId || s.raConsultantId === selectedConsultantId);
    });

    // 「本日の対応」サマリー用件数算出
    const caBallCount = filteredSelections.filter(s => s.currentBall === 'CA' && s.phase !== '選考終了' && s.phase !== '内定辞退').length;
    const raBallCount = filteredSelections.filter(s => s.currentBall === 'RA' && s.phase !== '選考終了' && s.phase !== '内定辞退').length;
    const overdueCount = filteredSelections.filter(s => {
      if (s.phase === '選考終了' || s.phase === '内定辞退') return false;
      const comp = companiesMap.get(s.companyId);
      return store.getSelectionAlerts ? store.getSelectionAlerts(s, comp).isOverdue : false;
    }).length;
    const waitingCompanyCount = filteredSelections.filter(s => (s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち') && s.phase !== '選考終了' && s.phase !== '内定辞退').length;

    // 1. Q承諾実績
    const acceptedSelections = filteredSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const qAcceptedCount = acceptedSelections.length;

    // 2. 進行中案件の決定（対象Q限定 or 全進行案件: Step 20項）
    const allActiveSelections = filteredSelections.filter(s => !['選考終了', '内定辞退', '内定承諾', '入社予定', '書類見送り', '面接見送り', '候補者辞退', '他社決定'].includes(s.phase));
    
    const inProgressSelectionsInQ = showAllInProgress
      ? allActiveSelections
      : allActiveSelections.filter(s => isSelectionInQuarter(s, selectedFiscalYear, selectedQuarter));

    // ヨミの正規化合計計算
    const rawYomiSum = inProgressSelectionsInQ.reduce((sum, s) => sum + normalizeYomi(s.yomi), 0);
    const qInProgressYomi = Math.round(rawYomiSum * 100) / 100;

    // 3. 着地見込み, 4. 不足ヨミ, 5. 達成率 (Step 7項: RA時は「対象外」)
    const isRaFilterMode = selectedConsultantId !== 'ALL' && activeRoleType === 'RA';
    const targetGoal = isRaFilterMode ? null : (selectedConsultantId === 'ALL' ? teamQTarget : (qTargetMap.get(selectedConsultantId) || 4));

    const qForecastTotal = Math.round((qAcceptedCount + qInProgressYomi) * 100) / 100;
    const qShortage = targetGoal !== null ? Math.max(0, Math.round((targetGoal - qForecastTotal) * 100) / 100) : 0;
    const qAchievementRate = (targetGoal !== null && targetGoal > 0) ? Math.round((qForecastTotal / targetGoal) * 1000) / 10 : 0;

    // キーワード検索 ＆ ボール絞り込み適用 (Step 10, 13, 18, 19項)
    let displayTableSelections = inProgressSelectionsInQ.filter(s => {
      if (activeBallFilter === 'CA' && s.currentBall !== 'CA') return false;
      if (activeBallFilter === 'RA' && s.currentBall !== 'RA') return false;
      if (activeBallFilter === 'COMPANY' && s.currentBall !== 'COMPANY' && s.companyActionStatus !== '企業回答待ち') return false;
      if (activeBallFilter === 'OVERDUE') {
        const comp = companiesMap.get(s.companyId);
        if (!store.getSelectionAlerts || !store.getSelectionAlerts(s, comp).isOverdue) return false;
      }

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const candName = (s.candidateName || '').toLowerCase();
        const compName = (s.companyName || '').toLowerCase();
        const jobName = (s.jobName || '').toLowerCase();
        const caName = (s.caName || '').toLowerCase();
        const raName = (s.raName || '').toLowerCase();

        if (!candName.includes(kw) && !compName.includes(kw) && !jobName.includes(kw) && !caName.includes(kw) && !raName.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    let scopeBadgeLabel = '集計対象: チーム全体';
    if (selectedConsultantId !== 'ALL') {
      const selectedCons = consultantsMap.get(selectedConsultantId);
      const cName = selectedCons ? selectedCons.name : '担当者';
      scopeBadgeLabel = `集計対象: ${cName} (${activeRoleType}担当)`;
    }

    const baseFY = currentInitialFQ.fiscalYear;
    const fyOptions = [baseFY - 1, baseFY, baseFY + 1, baseFY + 2];

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 画面ヘッダー & フィルターコントロール (指示書 Step 5) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">全体選考・ヨミダッシュボード</h2>
              <span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-lg border border-indigo-200 text-xs">${scopeBadgeLabel}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">※本システムのホーム操作画面です。各種集計とワンクリック操作・検索を完備しています。</p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-bold text-slate-700">対象年度:</span>
            <select id="select-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${fyOptions.map(fy => `<option value="${fy}" ${selectedFiscalYear === fy ? 'selected' : ''}>${fy}年度</option>`).join('')}
            </select>

            <span class="font-bold text-slate-700 ml-1">四半期 (Q):</span>
            <select id="select-fiscal-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900 focus:outline-none focus:border-indigo-600">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

            <span class="font-bold text-slate-700 ml-1">担当者:</span>
            <select id="select-dashboard-consultant" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              <option value="ALL" ${selectedConsultantId === 'ALL' ? 'selected' : ''}>チーム全体 (全CA/RA)</option>
              ${consultants.map(c => {
                const cRoleLabel = c.roles && Array.isArray(c.roles) && c.roles.length > 0 ? c.roles.join('・') : (c.roleType || 'CA');
                return `<option value="${c.consultantId}" ${selectedConsultantId === c.consultantId ? 'selected' : ''}>${c.name} (${cRoleLabel})</option>`;
              }).join('')}
            </select>

            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold ml-1">
              <button id="btn-in-q-only" class="px-2.5 py-1 rounded text-xs transition ${!showAllInProgress ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">対象Q案件</button>
              <button id="btn-all-in-prog" class="px-2.5 py-1 rounded text-xs transition ${showAllInProgress ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">全進行案件</button>
            </div>
          </div>
        </div>

        <!-- 本日の対応 サマリーエリア (Step 9項) -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'CA' ? 'bg-indigo-600 text-white shadow-md border-indigo-700' : 'bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100 text-indigo-950'}" id="dash-card-ca-ball">
            <div class="text-xs font-extrabold opacity-90">CA対応</div>
            <div class="text-2xl font-black mt-1">${caBallCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: CA</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'RA' ? 'bg-sky-600 text-white shadow-md border-sky-700' : 'bg-sky-50/70 border-sky-200 hover:bg-sky-100 text-sky-950'}" id="dash-card-ra-ball">
            <div class="text-xs font-extrabold opacity-90">RA対応</div>
            <div class="text-2xl font-black mt-1">${raBallCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: RA</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'OVERDUE' ? 'bg-rose-600 text-white shadow-md border-rose-700' : 'bg-rose-50/70 border-rose-200 hover:bg-rose-100 text-rose-950'}" id="dash-card-overdue">
            <div class="text-xs font-extrabold opacity-90">期限超過</div>
            <div class="text-2xl font-black mt-1">${overdueCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">要緊急対応</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'COMPANY' ? 'bg-amber-600 text-white shadow-md border-amber-700' : 'bg-amber-50/70 border-amber-200 hover:bg-amber-100 text-amber-950'}" id="dash-card-company-waiting">
            <div class="text-xs font-extrabold opacity-90">企業回答待ち</div>
            <div class="text-2xl font-black mt-1">${waitingCompanyCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: 企業</div>
          </div>
        </div>

        <!-- 6大集計数値カード (Step 5, 6, 7項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <!-- 1. Q目標 -->
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm space-y-1">
            <div class="text-xs text-slate-400 font-semibold">${isRaFilterMode ? 'Q目標' : (selectedConsultantId === 'ALL' ? 'チームQ目標 (CA合計)' : '個人Q目標')}</div>
            <div class="text-2xl font-black mt-1">
              ${targetGoal === null ? '<span class="text-sm text-amber-400 font-bold">対象外</span>' : `${targetGoal}<span class="text-xs font-normal text-slate-400 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-slate-400">${isRaFilterMode ? 'RA表示時は対象外' : (selectedConsultantId === 'ALL' ? '全CA目標の合算' : '個人Q目標')}</div>
          </div>

          <!-- 2. Q承諾実績 -->
          <div class="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm space-y-1">
            <div class="text-xs text-emerald-800 font-extrabold">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${qAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
            <div class="text-[10px] text-emerald-700">期間内の確定承諾数</div>
          </div>

          <!-- 3. Q進行中ヨミ -->
          <div class="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-sm space-y-1">
            <div class="text-xs text-indigo-800 font-extrabold">Q進行中ヨミ</div>
            <div class="text-2xl font-black text-indigo-600 mt-1">${qInProgressYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
            <div class="text-[10px] text-indigo-700">着地見込みヨミの加算値</div>
          </div>

          <!-- 4. Q着地見込み -->
          <div class="bg-purple-50/70 p-4 rounded-xl border border-purple-200 shadow-sm space-y-1">
            <div class="text-xs text-purple-800 font-extrabold">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600 mt-1">${qForecastTotal}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
            <div class="text-[10px] text-purple-700">承諾実績 ＋ 進行中ヨミ</div>
          </div>

          <!-- 5. Q目標不足ヨミ -->
          <div class="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm space-y-1">
            <div class="text-xs text-rose-800 font-extrabold">Q目標不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600 mt-1">
              ${targetGoal === null ? '<span class="text-sm text-rose-400 font-bold">対象外</span>' : `${qShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-rose-700">${targetGoal === null ? 'RA表示時は対象外' : '目標との差分Gap'}</div>
          </div>

          <!-- 6. Q見込み達成率 -->
          <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm space-y-1">
            <div class="text-xs text-amber-800 font-extrabold">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">
              ${targetGoal === null ? '<span class="text-sm text-amber-400 font-bold">対象外</span>' : `${qAchievementRate}%`}
            </div>
            <div class="text-[10px] text-amber-700">${targetGoal === null ? 'RA表示時は対象外' : '着地見込み ÷ 目標'}</div>
          </div>
        </div>

        <!-- 担当案件一覧テーブル & リアルタイム検索バー (Step 10, 11, 13, 18, 19項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>対象Q 進行案件一覧 (${displayTableSelections.length}件)</span>
                ${activeBallFilter !== 'ALL' ? `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px]">絞り込み: ${activeBallFilter}</span>` : ''}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">※次行動・ボール確認およびワンクリックでのバトンタッチが可能です。</p>
            </div>

            <!-- 検索バー (Step 19項) -->
            <div class="flex items-center space-x-2">
              <input type="text" id="input-dashboard-search" value="${searchKeyword}" placeholder="候補者名 / 企業名 / 求人 / CA / RA で検索..." class="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[240px]">
              ${activeBallFilter !== 'ALL' ? `<button id="btn-reset-ball-filter" class="text-xs text-indigo-600 underline font-bold px-1">全件解除</button>` : ''}
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名 / 次行動</th>
                  <th class="px-4 py-3">応募先企業</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">担当CA</th>
                  <th class="px-3 py-3">担当RA</th>
                  <th class="px-3 py-3">選考フェーズ / ボール</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${displayTableSelections.length === 0 ? `
                  <tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">条件に該当する進行案件がありません。</td></tr>
                ` : displayTableSelections.map(s => {
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                  const raCons = consultantsMap.get(s.raId || s.raConsultantId);
                  const normalizedYomiVal = normalizeYomi(s.yomi);
                  const percentStr = Math.round(normalizedYomiVal * 100) + '%';

                  return `
                    <tr class="hover:bg-indigo-50/40 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">
                        <div>${s.candidateName}</div>
                        <div class="text-[10px] text-indigo-600 font-semibold mt-0.5">次行動: ${s.nextAction || '要確認'}</div>
                      </td>
                      <td class="px-4 py-2.5 font-medium text-slate-800">${comp ? comp.name : s.companyName}</td>
                      <td class="px-4 py-2.5 text-slate-600">${job ? (job.title || job.jobName) : s.jobName}</td>
                      <td class="px-3 py-2.5 font-semibold text-slate-700">${caCons ? caCons.name : (s.caName || '-')}</td>
                      <td class="px-3 py-2.5 font-semibold text-slate-700">${raCons ? raCons.name : (s.raName || '-')}</td>
                      <td class="px-3 py-2.5 font-semibold text-indigo-700">
                        <div>${s.phase}</div>
                        <span class="text-[9px] font-bold ${s.currentBall === 'CA' ? 'bg-indigo-100 text-indigo-800' : (s.currentBall === 'RA' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800')} px-1.5 py-0.2 rounded">ボール: ${s.currentBall || 'CA'}</span>
                      </td>
                      <td class="px-3 py-2.5 text-right font-black ${normalizedYomiVal > 0 ? 'text-indigo-600' : 'text-slate-400'}">${percentStr}</td>
                      <td class="px-3 py-2.5 font-mono text-slate-700 font-bold">${s.expectedCompletionMonth || s.actionDeadline || '-'}</td>
                      <td class="px-3 py-2.5 text-right">
                        <div class="flex items-center justify-end space-x-1">
                          <button data-dash-ca-act="GOT_DATES" data-id="${s.selectionId}" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold shadow-2xs">候補日取得</button>
                          <button data-dash-ca-act="ACCEPT_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold shadow-2xs">承諾意向</button>
                          <button class="btn-detail px-2.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded text-[10px] transition shadow-2xs" data-id="${s.selectionId}">詳細</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // イベントリスナーの設定
    container.querySelector('#select-fiscal-year')?.addEventListener('change', (e) => {
      selectedFiscalYear = parseInt(e.target.value, 10);
      saveDashboardState({ fiscalYear: selectedFiscalYear });
      updateView();
    });

    container.querySelector('#select-fiscal-q')?.addEventListener('change', (e) => {
      selectedQuarter = e.target.value;
      saveDashboardState({ quarter: selectedQuarter });
      updateView();
    });

    container.querySelector('#select-dashboard-consultant')?.addEventListener('change', (e) => {
      selectedConsultantId = e.target.value;
      saveDashboardState({ consultantId: selectedConsultantId });
      updateView();
    });

    container.querySelector('#btn-in-q-only')?.addEventListener('click', () => {
      showAllInProgress = false;
      saveDashboardState({ showAllInProgress: false });
      updateView();
    });

    container.querySelector('#btn-all-in-prog')?.addEventListener('click', () => {
      showAllInProgress = true;
      saveDashboardState({ showAllInProgress: true });
      updateView();
    });

    container.querySelector('#input-dashboard-search')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      saveDashboardState({ searchKeyword });
      updateView();
    });

    // 「本日の対応」サマリーカードのクリックフィルタリング (Step 10, 13項)
    container.querySelector('#dash-card-ca-ball')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'CA' ? 'ALL' : 'CA';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-ra-ball')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'RA' ? 'ALL' : 'RA';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-overdue')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'OVERDUE' ? 'ALL' : 'OVERDUE';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-company-waiting')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'COMPANY' ? 'ALL' : 'COMPANY';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#btn-reset-ball-filter')?.addEventListener('click', () => {
      activeBallFilter = 'ALL';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    // ワンクリックバトンボタン (Step 11項)
    container.querySelectorAll('button[data-dash-ca-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-dash-ca-act');
        store.handleCaAction(selId, act);
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        if (onOpenDetail) {
          onOpenDetail(selId);
        } else if (onNavigateToSelections) {
          onNavigateToSelections(selId);
        }
      });
    });

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }
  }

  updateView({ preserveScroll: false });
}


/**
 * 選考進捗・ヨミ管理システム - 選考案件一覧画面コンポーネント (デフォルト並び順: フェーズが進んでいる順 & 状態永続保持対応)
 */






const SELECTION_LIST_STORAGE_KEY = 'selection_list_active_state';

function getSavedListState() {
  try {
    const raw = sessionStorage.getItem(SELECTION_LIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveListState(state) {
  try {
    const current = getSavedListState();
    sessionStorage.setItem(SELECTION_LIST_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderSelectionList(container, options = {}, callbacks = {}) {
  let initialFilter = {};
  let onOpenDetail = null;
  let onOpenNewModal = null;

  if (typeof options === 'object' && (options.onOpenDetail || options.onOpenNewModal)) {
    onOpenDetail = options.onOpenDetail;
    onOpenNewModal = options.onOpenNewModal;
    initialFilter = options.initialFilter || {};
  } else {
    initialFilter = options || {};
    if (typeof callbacks === 'object') {
      onOpenDetail = callbacks.onOpenDetail;
      onOpenNewModal = callbacks.onOpenNewModal;
    }
  }

  const savedState = getSavedListState();

  let viewMode = savedState.viewMode || initialFilter.viewMode || 'activeOnly'; // activeOnly (既定) | includeEnded | endedOnly
  let selectedEndReason = savedState.selectedEndReason !== undefined ? savedState.selectedEndReason : (initialFilter.endReason || '');
  let sortBy = savedState.sortBy || 'phase_desc'; // フェーズが進んでいる順 (デフォルト既定) (指示書 1, 4項)

  let searchKeyword = savedState.searchKeyword !== undefined ? savedState.searchKeyword : (initialFilter.keyword || '');
  let selectedPhase = savedState.selectedPhase !== undefined ? savedState.selectedPhase : (initialFilter.phase || '');
  let selectedStatus = savedState.selectedStatus !== undefined ? savedState.selectedStatus : (initialFilter.status || '');
  let selectedCaId = savedState.selectedCaId !== undefined ? savedState.selectedCaId : (initialFilter.caId || '');
  let selectedRaId = savedState.selectedRaId !== undefined ? savedState.selectedRaId : (initialFilter.raId || '');
  let selectedCompanyRank = savedState.selectedCompanyRank !== undefined ? savedState.selectedCompanyRank : (initialFilter.rank || '');
  let selectedEntrySource = savedState.selectedEntrySource !== undefined ? savedState.selectedEntrySource : (initialFilter.entrySource || '');

  function updateView(preserveScroll = true) {
    const savedScrollY = preserveScroll ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const rawSelections = store.getSelections();
    const candidates = store.getCandidates();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const consultants = store.getConsultants();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    // 互換読み替えを行った選考データ
    const selections = rawSelections.map(s => {
      const norm = normalizeSelectionPhaseAndReason(s);
      return { ...s, phase: norm.phase, progressStatus: norm.progressStatus, endReason: norm.endReason || s.endReason };
    });

    // 1. フィルタリング処理 (指示書 2, 4, 8項)
    const filteredSelections = selections.filter(s => {
      if (s.isArchived) return false;

      const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';

      if (viewMode === 'activeOnly' && isEnded) return false;
      if (viewMode === 'endedOnly' && !isEnded) return false;

      if ((viewMode === 'includeEnded' || viewMode === 'endedOnly') && selectedEndReason) {
        if (selectedEndReason === '内定辞退') {
          if (s.phase !== '内定辞退' && s.endReason !== '内定辞退') return false;
        } else {
          if (s.endReason !== selectedEndReason) return false;
        }
      }

      const cand = candidatesMap.get(s.candidateId);
      const comp = companiesMap.get(s.companyId);
      const job = jobsMap.get(s.jobId);

      const candName = cand ? cand.name : s.candidateName || '';
      const compName = comp ? comp.name : s.companyName || '';
      const jobTitle = job ? (job.title || job.jobName) : s.jobName || '';

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const matchName = candName.toLowerCase().includes(kw);
        const matchComp = compName.toLowerCase().includes(kw);
        const matchJob = jobTitle.toLowerCase().includes(kw);
        const matchMemo = (s.internalMemo || '').toLowerCase().includes(kw);
        const matchDetail = (s.entrySourceDetail || '').toLowerCase().includes(kw);

        if (!matchName && !matchComp && !matchJob && !matchMemo && !matchDetail) return false;
      }

      if (selectedPhase && s.phase !== selectedPhase) return false;
      if (selectedStatus && s.progressStatus !== selectedStatus) return false;
      if (selectedCaId && (s.caId !== selectedCaId && s.caConsultantId !== selectedCaId)) return false;
      if (selectedRaId && (s.raId !== selectedRaId && s.raConsultantId !== selectedRaId)) return false;
      if (selectedCompanyRank && comp && comp.rank !== selectedCompanyRank) return false;

      if (selectedEntrySource) {
        if (selectedEntrySource === 'UNSET') {
          if (s.entrySource && s.entrySource !== 'UNSET') return false;
        } else {
          if (s.entrySource !== selectedEntrySource) return false;
        }
      }

      return true;
    });

    // 2. ソート処理 (指定どおりのデフォルト並び順: フェーズが進んでいる順) (指示書 1, 3, 4, 5項)
    const sortedSelections = sortSelections(filteredSelections, sortBy);

    const activeCount = sortedSelections.length;
    const uniquePeopleCount = calculateUniqueCandidatesCount(sortedSelections, viewMode !== 'activeOnly');

    // 状態の永続保存 (指示書 7項)
    saveListState({
      viewMode,
      selectedEndReason,
      sortBy,
      searchKeyword,
      selectedPhase,
      selectedStatus,
      selectedCaId,
      selectedRaId,
      selectedCompanyRank,
      selectedEntrySource,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー見出し -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">選考案件一覧</h2>
              <span class="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 font-extrabold rounded-full text-xs border border-indigo-200">
                ${activeCount} 案件 ／ ${uniquePeopleCount} 名
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">※初期表示順：選考フェーズが進んでいる順 (内定 ➔ 条件提示 ➔ 最終 ➔ 二次 ➔ 一次 ➔ 書類)</p>
          </div>

          <!-- 表示対象モード切り替え (指示書 8項) -->
          <div class="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-xs font-bold">
            <button id="btn-view-active" class="px-3 py-1.5 rounded-md transition ${viewMode === 'activeOnly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              進行中のみ (既定)
            </button>
            <button id="btn-view-all" class="px-3 py-1.5 rounded-md transition ${viewMode === 'includeEnded' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              終了案件を含む
            </button>
            <button id="btn-view-ended" class="px-3 py-1.5 rounded-md transition ${viewMode === 'endedOnly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
              終了案件のみ
            </button>
          </div>
        </div>

        <!-- 検索・絞り込み ＆ 並び替えコントロールパネル (指示書 4項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <!-- キーワード -->
            <div class="lg:col-span-2">
              <label class="block text-slate-600 font-bold mb-1">キーワード検索</label>
              <input type="text" id="filter-keyword" value="${searchKeyword}" placeholder="候補者名、企業名、求人名..." class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:bg-white focus:outline-none">
            </div>

            <!-- 並び替え (既定: フェーズが進んでいる順) (指示書 4項) -->
            <div class="lg:col-span-2">
              <label class="block text-indigo-900 font-bold mb-1 flex items-center gap-1">
                <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>
                並び替え
              </label>
              <select id="select-sort-by" class="w-full bg-indigo-50 border border-indigo-200 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="phase_desc" ${sortBy === 'phase_desc' ? 'selected' : ''}>フェーズが進んでいる順 (既定)</option>
                <option value="nextDate_asc" ${sortBy === 'nextDate_asc' ? 'selected' : ''}>次回予定日が近い順</option>
                <option value="updated_desc" ${sortBy === 'updated_desc' ? 'selected' : ''}>最終更新日が新しい順</option>
                <option value="yomi_desc" ${sortBy === 'yomi_desc' ? 'selected' : ''}>ヨミが高い順</option>
                <option value="candName_asc" ${sortBy === 'candName_asc' ? 'selected' : ''}>候補者名五十音順</option>
              </select>
            </div>

            <!-- 選考フェーズ -->
            <div>
              <label class="block text-slate-600 font-bold mb-1">選考フェーズ</label>
              <select id="filter-phase" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
                <option value="">すべてのフェーズ</option>
                ${PHASES.map(p => `<option value="${p}" ${selectedPhase === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>

            <!-- 終了理由フィルター -->
            ${viewMode !== 'activeOnly' ? `
              <div>
                <label class="block text-rose-800 font-bold mb-1">終了理由</label>
                <select id="filter-end-reason" class="w-full bg-rose-50 border border-rose-200 text-rose-900 font-bold rounded px-2.5 py-1.5 focus:outline-none">
                  <option value="">すべての理由</option>
                  ${END_REASONS.map(r => `<option value="${r}" ${selectedEndReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </div>
            ` : ''}

            <!-- エントリー経路 -->
            <div>
              <label class="block text-indigo-700 font-bold mb-1">エントリー経路</label>
              <select id="filter-entry-source" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold rounded px-2.5 py-1.5 focus:outline-none">
                <option value="">すべての経路</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${selectedEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
                <option value="UNSET" ${selectedEntrySource === 'UNSET' ? 'selected' : ''}>未設定</option>
              </select>
            </div>

            <!-- 担当CA -->
            <div>
              <label class="block text-slate-600 font-bold mb-1">担当CA</label>
              <select id="filter-ca" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="">すべてのCA</option>
                ${consultants.map(c => `<option value="${c.consultantId}" ${selectedCaId === c.consultantId ? 'selected' : ''}>${c.name} (${c.roleType || 'CA'})</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- 案件一覧テーブル -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名 (担当CA)</th>
                  <th class="px-4 py-3">企業名 (ランク/担当RA)</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">経路</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3">進行状態 / 理由</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">次回予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${sortedSelections.length === 0 ? `
                  <tr><td colspan="9" class="text-center py-12 text-slate-400">条件に該当する選考案件がありません。</td></tr>
                ` : sortedSelections.map(s => {
                  const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                  const cand = candidatesMap.get(s.candidateId);
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                  const raCons = consultantsMap.get(s.raId || s.raConsultantId);

                  const entryObj = ENTRY_SOURCES.find(es => es.code === s.entrySource);
                  const entryLabel = entryObj ? entryObj.label : '未設定';

                  return `
                    <tr class="${isEnded ? 'bg-slate-100/70 text-slate-500' : 'hover:bg-slate-50'} transition">
                      <td class="px-4 py-3 font-bold text-slate-900">
                        <div class="${isEnded ? 'line-through text-slate-500' : ''}">${cand ? cand.name : s.candidateName} 様</div>
                        <div class="text-[10px] text-indigo-700 font-semibold">CA: ${caCons ? caCons.name : '-'}</div>
                      </td>
                      <td class="px-4 py-3 font-medium text-slate-800">
                        <div class="flex items-center gap-1">
                          <span>${comp ? comp.name : s.companyName}</span>
                          ${comp ? `<span class="px-1.5 py-0.2 text-[9px] font-extrabold rounded bg-amber-100 text-amber-800">${comp.rank}</span>` : ''}
                        </div>
                        <div class="text-[10px] text-slate-500">RA: ${raCons ? raCons.name : '-'}</div>
                      </td>
                      <td class="px-4 py-3 text-slate-700 font-medium">${job ? (job.title || job.jobName) : s.jobName}</td>

                      <td class="px-3 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.entrySource === 'PASS_UP' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-slate-100 text-slate-700'}">
                          ${entryLabel}
                        </span>
                      </td>

                      <td class="px-3 py-3 font-bold">
                        ${s.phase === '内定辞退' ? `
                          <span class="px-2 py-0.5 bg-slate-500 text-white rounded text-[10px] font-extrabold">内定辞退</span>
                        ` : (s.phase === '選考終了' ? `
                          <span class="px-2 py-0.5 bg-slate-300 text-slate-800 rounded text-[10px] font-bold">選考終了</span>
                        ` : `
                          <span class="text-indigo-700">${s.phase}</span>
                        `)}
                      </td>

                      <td class="px-3 py-3 font-semibold">
                        <div>${s.progressStatus}</div>
                        ${s.endReason ? `<div class="text-[10px] text-rose-700 font-bold">${s.endReason}</div>` : ''}
                      </td>

                      <td class="px-3 py-3 text-right font-black ${isEnded ? 'text-slate-400' : 'text-indigo-600'}">
                        ${isEnded ? '0%' : (s.yomi * 100 + '%')}
                      </td>
                      <td class="px-3 py-3 text-slate-600 font-mono">${s.nextScheduleDate || '-'}</td>

                      <td class="px-3 py-3 text-center">
                        <button type="button" class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-800 rounded text-xs font-bold transition cursor-pointer" data-id="${s.selectionId}">
                          詳細
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // 描画後のスクロール位置復元 (指示書 7項)
    if (preserveScroll && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    // イベントバインド
    container.querySelector('#btn-view-active')?.addEventListener('click', () => {
      viewMode = 'activeOnly';
      updateView(true);
    });
    container.querySelector('#btn-view-all')?.addEventListener('click', () => {
      viewMode = 'includeEnded';
      updateView(true);
    });
    container.querySelector('#btn-view-ended')?.addEventListener('click', () => {
      viewMode = 'endedOnly';
      updateView(true);
    });

    container.querySelector('#select-sort-by')?.addEventListener('change', (e) => {
      sortBy = e.target.value;
      updateView(true);
    });

    container.querySelector('#filter-end-reason')?.addEventListener('change', (e) => {
      selectedEndReason = e.target.value;
      updateView(true);
    });

    container.querySelector('#filter-keyword')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-phase')?.addEventListener('change', (e) => {
      selectedPhase = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-entry-source')?.addEventListener('change', (e) => {
      selectedEntrySource = e.target.value;
      updateView(true);
    });
    container.querySelector('#filter-ca')?.addEventListener('change', (e) => {
      selectedCaId = e.target.value;
      updateView(true);
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveListState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        const selectionId = btn.getAttribute('data-id');
        if (selectionId && typeof onOpenDetail === 'function') {
          onOpenDetail(selectionId);
        }
      });
    });
  }

  updateView(true);
}


/**
 * 選考進捗・ヨミ管理システム - 選考案件詳細・編集モーダルコンポーネント (選考終了・内定辞退入力 & 直前フェーズ保存対応)
 */





function openSelectionDetailModal(selectionId, onClose) {
  let modalEl = document.getElementById('selection-detail-modal');
  if (modalEl) modalEl.remove();

  const selections = store.getSelections();
  const selection = selections.find(s => s.selectionId === selectionId);
  if (!selection) return;

  const candidates = store.getCandidates();
  const companies = store.getCompanies();
  const jobs = store.getJobs();
  const consultants = store.getConsultants();
  const histories = store.getHistories(selectionId);

  const cand = candidates.find(c => c.candidateId === selection.candidateId);
  const comp = companies.find(c => c.companyId === selection.companyId);
  const job = jobs.find(j => j.jobId === selection.jobId);
  const caCons = consultants.find(c => c.consultantId === (selection.caId || selection.caConsultantId));
  const raCons = consultants.find(c => c.consultantId === (selection.raId || selection.raConsultantId));

  const caConsultants = store.getCaConsultants();
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'selection-detail-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  const defaultMonth = selection.expectedCompletionMonth || new Date().toISOString().slice(0, 7);
  const defaultQInfo = getQuarterFromYearMonth(defaultMonth);

  const currentEntrySource = selection.entrySource || 'UNSET';
  const isPassUp = currentEntrySource === 'PASS_UP';
  const isOther = currentEntrySource === 'OTHER';
  const isEnded = selection.phase === '選考終了' || selection.phase === '内定辞退';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <!-- モーダルヘッダー -->
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <div class="flex items-center space-x-2">
            <span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded font-mono">ID: ${selection.selectionId}</span>
            <h3 class="text-base font-bold">${cand ? cand.name : selection.candidateName} 様 ／ ${comp ? comp.name : selection.companyName}</h3>
          </div>
          <p class="text-xs text-slate-400 mt-0.5">求人: ${job ? (job.title || job.jobName) : selection.jobName} (担当CA: ${caCons ? caCons.name : '未設定'} / 担当RA: ${raCons ? raCons.name : '未設定'})</p>
        </div>
        <button id="btn-detail-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <!-- モーダルボディ -->
      <div class="p-6 overflow-y-auto space-y-6 flex-1">
        <form id="form-selection-detail" class="space-y-5" onsubmit="return false;">
          <!-- 1. フェーズ・進行状態・ヨミ設定 -->
          <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3">
            <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              選考状況 ＆ ヨミの更新
            </h4>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1">選考フェーズ</label>
                <select id="detail-phase" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                  ${PHASES.map(p => `<option value="${p}" ${selection.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">進行状態</label>
                <select id="detail-status" class="w-full bg-white border border-slate-300 font-medium text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                  ${PROGRESS_STATUSES.map(s => `<option value="${s}" ${selection.progressStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">ヨミ (内定承諾確率)</label>
                <select id="detail-yomi" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                  ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${Number(selection.yomi) === y.value ? 'selected' : ''}>${y.label} (${y.value * 100}%)</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- 選考終了・内定辞退入力エリア (指示書 19, 20項) -->
            <div id="detail-container-end-reason" class="p-3 bg-rose-50 rounded-lg border border-rose-200 space-y-2 ${isEnded ? '' : 'hidden'}">
              <div class="flex items-center justify-between">
                <label class="font-bold text-rose-900">終了理由 <span class="text-rose-600">*</span></label>
                <span id="detail-badge-decline-prev" class="text-[10px] font-bold text-slate-600">
                  ${selection.previousPhaseBeforeDecline ? `辞退前フェーズ: ${selection.previousPhaseBeforeDecline}` : ''}
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select id="detail-end-reason" class="w-full bg-white border border-rose-300 font-bold text-rose-900 rounded px-2.5 py-1.5 focus:outline-none">
                  <option value="">終了理由を選択...</option>
                  ${END_REASONS.map(r => `<option value="${r}" ${selection.endReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
                <input type="text" id="detail-end-reason-detail" value="${selection.endReasonDetail || selection.declineReason || ''}" placeholder="詳細理由・辞退理由を入力..." class="w-full bg-white border border-rose-300 rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              </div>
            </div>

            <!-- ヨミ設定理由 -->
            <div>
              <label class="block font-semibold text-slate-700 mb-1">ヨミ設定理由</label>
              <input type="text" id="detail-yomi-reason" value="${selection.yomiReason || ''}" placeholder="本人の志望度、面接評価などの根拠" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>
          </div>

          <!-- 2. エントリー経路 ＆ パスアップ詳細 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">エントリー経路</label>
              <select id="detail-entry-source" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="UNSET">未設定</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${currentEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </div>

            <div id="detail-container-entry-detail" class="${(isPassUp || isOther) ? '' : 'hidden'}">
              <label id="detail-label-entry-detail" class="block font-bold text-slate-800 mb-1">${isPassUp ? 'パスアップ詳細' : '経路詳細'} <span class="text-rose-500">*</span></label>
              <input type="text" id="detail-entry-detail" value="${selection.entrySourceDetail || ''}" placeholder="詳細を入力" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
            </div>
          </div>

          <!-- 3. スケジュール ＆ 完了見込み月 -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">推薦日</label>
              <input type="date" id="detail-recommendation-date" value="${selection.recommendationDate || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">次回予定日 (面接等)</label>
              <input type="date" id="detail-next-date" value="${selection.nextScheduleDate || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">完了見込み月</label>
                <span id="detail-badge-q-forecast" class="text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">
                  ${defaultQInfo ? `着地見込みQ：${defaultQInfo.label}` : '着地見込みQ：未設定'}
                </span>
              </div>
              <input type="month" id="detail-expected-month" value="${selection.expectedCompletionMonth || ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none">
            </div>
          </div>

          <!-- 4. CA/RA 担当コンサル設定 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label class="block font-bold text-slate-700 mb-1">担当CA</label>
              <select id="detail-ca-id" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-700 focus:outline-none">
                ${caConsultants.map(c => `<option value="${c.consultantId}" ${(selection.caId || selection.caConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">担当RA</label>
              <select id="detail-ra-id" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-700 focus:outline-none">
                ${raConsultants.map(c => `<option value="${c.consultantId}" ${(selection.raId || selection.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 5. 企業対応・確認事項設定 -->
          <div class="bg-amber-50/40 p-4 rounded-xl border border-amber-100 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                企業向け確認・対応設定 (RA用)
              </h4>

              <div class="flex items-center space-x-2">
                <span id="detail-badge-action-source" class="text-[10px] font-bold px-2 py-0.5 rounded ${selection.companyActionSource === 'manual' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-indigo-100 text-indigo-900 border border-indigo-200'}">
                  ${selection.companyActionSource === 'manual' ? '手動設定済み' : '選考状況から自動判定中'}
                </span>
                <button type="button" id="btn-reset-auto-action" class="px-2.5 py-1 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 text-[10px] font-bold rounded border border-indigo-300 shadow-2xs transition">
                  自動設定へ戻す
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-700 mb-1">企業対応区分</label>
                <select id="detail-company-action-type" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-indigo-800 focus:outline-none">
                  ${COMPANY_ACTION_TYPES.map(t => `<option value="${t}" ${selection.companyActionType === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">企業対応ステータス</label>
                <select id="detail-company-action-status" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
                  ${COMPANY_ACTION_STATUSES.map(st => `<option value="${st}" ${selection.companyActionStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
                </select>
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">企業への確認事項</label>
              <input type="text" id="detail-company-check-item" value="${selection.companyConfirmationItem || selection.companyCheckItems || ''}" placeholder="合否確認、条件面談の日程など" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">企業共有コメント (進捗メール用)</label>
              <input type="text" id="detail-company-shared-comment" value="${selection.companySharedComment || ''}" placeholder="企業への連絡メール本文に記載するメモ" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none">
            </div>
          </div>

          <!-- 6. 社内メモ -->
          <div>
            <label class="block font-semibold text-slate-700 mb-1">社内メモ (他社選考状況・辞退理由等)</label>
            <textarea id="detail-internal-memo" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2.5 focus:bg-white focus:outline-none leading-relaxed">${selection.internalMemo || ''}</textarea>
          </div>
        </form>

        <!-- 7. 変更履歴タイムライン -->
        <div class="border-t border-slate-200 pt-4 space-y-3">
          <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            選考変更履歴タイムライン (${histories.length}件)
          </h4>

          <div class="bg-slate-50 rounded-xl border border-slate-200 p-3 max-h-40 overflow-y-auto space-y-2 font-mono text-[11px]">
            ${histories.length === 0 ? `
              <div class="text-slate-400 text-center py-2">変更履歴はありません。</div>
            ` : histories.map(h => `
              <div class="bg-white p-2 rounded border border-slate-200 shadow-2xs space-y-0.5">
                <div class="flex items-center justify-between text-slate-500 text-[10px]">
                  <span>${new Date(h.changedAt).toLocaleString('ja-JP')}</span>
                  <span class="font-bold text-slate-700">${h.changedBy}</span>
                </div>
                <div class="font-bold text-slate-800">
                  <span class="text-indigo-600">${h.fieldName}</span>: ${h.previousValue} → <span class="text-emerald-600">${h.newValue}</span>
                </div>
                ${h.comment ? `<div class="text-slate-600 text-[10px] italic">💬 ${h.comment}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- モーダルフッター -->
      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <button type="button" id="btn-detail-archive" class="px-3.5 py-2 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded-lg text-xs font-bold transition">
          アーカイブ化 (非表示化)
        </button>

        <div class="flex items-center space-x-3">
          <button type="button" id="btn-detail-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition">
            キャンセル
          </button>
          <button type="button" id="btn-detail-save" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs shadow transition">
            変更を保存する
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const phaseSelect = modalEl.querySelector('#detail-phase');
  const yomiSelect = modalEl.querySelector('#detail-yomi');
  const endReasonContainer = modalEl.querySelector('#detail-container-end-reason');
  const endReasonSelect = modalEl.querySelector('#detail-end-reason');

  const entrySourceSelect = modalEl.querySelector('#detail-entry-source');
  const entryDetailContainer = modalEl.querySelector('#detail-container-entry-detail');
  const entryDetailLabel = modalEl.querySelector('#detail-label-entry-detail');
  const entryDetailInput = modalEl.querySelector('#detail-entry-detail');
  const monthInput = modalEl.querySelector('#detail-expected-month');
  const qBadge = modalEl.querySelector('#detail-badge-q-forecast');

  // フェーズ変更時の終了理由表示制御 ＆ ヨミ自動0リセット (指示書 17, 19, 20項)
  phaseSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === '選考終了' || val === '内定辞退') {
      endReasonContainer.classList.remove('hidden');
      yomiSelect.value = '0';
      if (val === '内定辞退' && !endReasonSelect.value) {
        endReasonSelect.value = '内定辞退';
      }
    } else {
      endReasonContainer.classList.add('hidden');
    }
  });

  entrySourceSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'PASS_UP') {
      entryDetailLabel.innerHTML = 'パスアップ詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = '例: 若山さんスカウト、自動スカウト';
      entryDetailContainer.classList.remove('hidden');
    } else if (val === 'OTHER') {
      entryDetailLabel.innerHTML = '経路詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = 'エントリー経路の詳細を入力してください';
      entryDetailContainer.classList.remove('hidden');
    } else {
      entryDetailContainer.classList.add('hidden');
      entryDetailInput.value = '';
    }
  });

  monthInput?.addEventListener('change', (e) => {
    const val = e.target.value;
    const qInfo = getQuarterFromYearMonth(val);
    if (qInfo) {
      qBadge.textContent = `着地見込みQ：${qInfo.label}`;
      qBadge.className = 'text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200';
    } else {
      qBadge.textContent = '着地見込みQ：未設定';
      qBadge.className = 'text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-200';
    }
  });

  let actionSourceState = selection.companyActionSource || 'auto';

  // 「自動設定へ戻す」ボタンイベント (指示書 24項)
  modalEl.querySelector('#btn-reset-auto-action')?.addEventListener('click', () => {
    if (confirm('現在の手動設定を解除し、選考フェーズ・進行状態に基づく自動設定へ戻しますか？')) {
      const p = phaseSelect.value;
      const st = modalEl.querySelector('#detail-status').value;
      const derived = store.getItem('selection_app_selections') ? import('../utils/kanbanCalculations.js').then(m => {
        const d = m.deriveCompanyActionFromSelection({ phase: p, progressStatus: st });
        modalEl.querySelector('#detail-company-action-type').value = d.companyActionType;
        modalEl.querySelector('#detail-company-action-status').value = d.companyActionStatus;
        modalEl.querySelector('#detail-company-check-item').value = d.companyConfirmationItem;
        actionSourceState = 'auto';

        const badge = modalEl.querySelector('#detail-badge-action-source');
        if (badge) {
          badge.textContent = '選考状況から自動判定中';
          badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 border border-indigo-200';
        }
      }) : null;
    }
  });

  // RA手動変更の検出 (指示書 8項)
  ['#detail-company-action-type', '#detail-company-action-status', '#detail-company-check-item'].forEach(selector => {
    modalEl.querySelector(selector)?.addEventListener('change', () => {
      actionSourceState = 'manual';
      const badge = modalEl.querySelector('#detail-badge-action-source');
      if (badge) {
        badge.textContent = '手動設定済み';
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300';
      }
    });
  });

  // 保存処理 (指示書 10, 12, 16, 22項)
  modalEl.querySelector('#btn-detail-save')?.addEventListener('click', () => {
    const newPhase = phaseSelect.value;
    const newStatus = modalEl.querySelector('#detail-status').value;
    const newYomi = Number(yomiSelect.value);
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();
    const endReason = endReasonSelect.value;
    const endReasonDetail = modalEl.querySelector('#detail-end-reason-detail').value.trim();

    if (entrySource === 'PASS_UP' && !entryDetail) {
      alert('パスアップの詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }
    if (entrySource === 'OTHER' && !entryDetail) {
      alert('経路詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }

    if ((newPhase === '選考終了' || newPhase === '内定辞退') && !endReason) {
      alert('選考終了理由または辞退理由を選択してください。');
      endReasonSelect.focus();
      return;
    }

    // 内定辞退変更時のダイアログ確認 ＆ 直前フェーズ保存 (指示書 15, 20項)
    let previousPhaseBeforeDecline = selection.previousPhaseBeforeDecline || null;
    let declinedAfterAcceptance = selection.declinedAfterAcceptance || false;

    if (newPhase === '内定辞退') {
      if (selection.phase !== '内定辞退') {
        if (!confirm(`この選考案件を「内定辞退」に変更しますか？\n\n・選考一覧・CA・RA・企業対応リストから非表示になります。\n・ホワイトボードにはグレーアウトして残ります。`)) {
          return;
        }
        previousPhaseBeforeDecline = selection.phase;
        if (selection.phase === '内定承諾') {
          declinedAfterAcceptance = true;
        }
      }
    } else if (newPhase === '選考終了') {
      if (selection.phase !== '選考終了') {
        if (!confirm(`この選考案件を選考終了にしますか？\n\n・選考一覧・CA・RA・企業対応リスト・ホワイトボードから非表示になります。\n・データと履歴は保存されます。`)) {
          return;
        }
      }
    }

    if (newPhase === '内定承諾' || newPhase === '入社予定') {
      const candSelections = store.getSelections().filter(s => s.candidateId === selection.candidateId && s.selectionId !== selection.selectionId && s.phase !== '選考終了' && s.phase !== '内定辞退');
      if (candSelections.length > 0) {
        const choice = confirm(`候補者「${cand ? cand.name : selection.candidateName}」が「${comp ? comp.name : selection.companyName}」で内定承諾となりました。\n現在併願進行中の他社選考案件（全${candSelections.length}件）を「選考終了（他社内定辞退）」に連動変更しますか？\n\n【OK】: 他社案件を一括辞退にする\n【キャンセル】: この案件のみ変更する`);
        if (choice) {
          store.declineOtherSelectionsForCandidate(selection.candidateId, selection.selectionId, `「${comp ? comp.name : selection.companyName}」での内定承諾に伴う自動辞退`);
        }
      }
    }

    const caId = modalEl.querySelector('#detail-ca-id').value;
    const raId = modalEl.querySelector('#detail-ra-id').value;
    const caConsObj = consultants.find(c => c.consultantId === caId);
    const raConsObj = consultants.find(c => c.consultantId === raId);

    // 手動設定保護オプションの判定 (指示書 10, 12, 16項)
    let saveOptions = { forceAuto: false, appendItem: false };
    const isPhaseOrStatusChanged = (newPhase !== selection.phase || newStatus !== selection.progressStatus);

    if (isPhaseOrStatusChanged && actionSourceState === 'manual') {
      const optChoice = prompt(
        `【手動設定の企業対応項目があります】\n選考フェーズ・進行状態の変更に伴い、企業対応項目をどのように保存しますか？\n\n1: 現在の手動設定を維持する (推奨)\n2: 新しいフェーズの自動候補へ更新する\n3: 現在の確認事項に自動候補を追記する\n\n(1〜3 の番号を入力してください):`,
        '1'
      );

      if (optChoice === '2') {
        saveOptions.forceAuto = true;
        actionSourceState = 'auto';
      } else if (optChoice === '3') {
        saveOptions.forceAuto = true;
        saveOptions.appendItem = true;
        actionSourceState = 'auto';
      }
    }

    store.updateSelection(selectionId, {
      phase: newPhase,
      progressStatus: newStatus,
      yomi: (newPhase === '選考終了' || newPhase === '内定辞退') ? 0 : newYomi,
      endReason: endReason || null,
      endReasonDetail: endReasonDetail || null,
      declineReason: newPhase === '内定辞退' ? endReasonDetail : selection.declineReason,
      previousPhaseBeforeDecline,
      declinedAfterAcceptance,
      yomiReason: modalEl.querySelector('#detail-yomi-reason').value,
      entrySource,
      entrySourceDetail: entryDetail,
      recommendationDate: modalEl.querySelector('#detail-recommendation-date').value,
      nextScheduleDate: modalEl.querySelector('#detail-next-date').value || null,
      expectedCompletionMonth: monthInput.value || null,
      caId: caId,
      caConsultantId: caId,
      caName: caConsObj ? caConsObj.name : selection.caName,
      raId: raId,
      raConsultantId: raId,
      raName: raConsObj ? raConsObj.name : selection.raName,
      companyActionType: modalEl.querySelector('#detail-company-action-type').value,
      companyActionStatus: modalEl.querySelector('#detail-company-action-status').value,
      companyConfirmationItem: modalEl.querySelector('#detail-company-check-item').value,
      companySharedComment: modalEl.querySelector('#detail-company-shared-comment').value,
      internalMemo: modalEl.querySelector('#detail-internal-memo').value,
      companyActionSource: actionSourceState
    }, '詳細モーダルからの保存', saveOptions);

    modalEl.remove();
    if (onClose) onClose();
  });

  modalEl.querySelector('#btn-detail-archive')?.addEventListener('click', () => {
    if (confirm('この選考案件をアーカイブ（非表示化）にしますか？')) {
      store.archiveSelection(selectionId);
      modalEl.remove();
      if (onClose) onClose();
    }
  });

  modalEl.querySelector('#btn-detail-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-detail-cancel')?.addEventListener('click', () => modalEl.remove());
}


/**
 * 選考進捗・ヨミ管理システム - ホワイトボード画面コンポーネント (クリーン再構築版)
 * 指示書 (全36項) に準拠し、データ層・詳細モーダルは保持のままUI表示のみを堅牢に一新
 */






const KANBAN_STORAGE_KEY = 'kanban_view_active_state_v3';

function getSavedKanbanState() {
  try {
    const raw = sessionStorage.getItem(KANBAN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveKanbanState(state) {
  try {
    const current = getSavedKanbanState();
    sessionStorage.setItem(KANBAN_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderKanbanView(container, { onOpenDetail, onNavigateToCompanyActions }) {
  const savedState = getSavedKanbanState();

  let selectedAxisMode = savedState.axisMode || 'ca';
  let isRaAreaOpen = savedState.isRaAreaOpen !== undefined ? savedState.isRaAreaOpen : true;
  let searchKeyword = savedState.searchKeyword || '';
  let filterCaId = savedState.filterCaId || '';
  let filterCompanySearch = savedState.filterCompanySearch || '';
  let lastUpdatedSelectionId = savedState.lastUpdatedSelectionId || null;

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;
    const savedScrollLeft = options.preserveScroll !== false ? (savedState.scrollLeft || 0) : 0;

    const isLoading = store.isLoading ? store.isLoading() : false;
    if (isLoading) {
      container.innerHTML = `
        <div class="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
          <p class="text-slate-700 font-bold text-sm">選考案件を読み込んでいます...</p>
        </div>
      `;
      return;
    }

    const selections = store.getSelections() || [];
    const companies = store.getCompanies() || [];
    const jobs = store.getJobs() || [];
    const candidates = store.getCandidates() || [];
    const consultants = store.getConsultants() || [];

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeSelections = selections.filter(s => {
      if (!s || s.isArchived || s.isDeleted) return false;
      const p = s.phase || '';
      return p !== '選考終了' && p !== '書類見送り' && p !== '面接見送り' && p !== '候補者辞退' && p !== '他社決定';
    });

    const enrichedSelections = activeSelections.map(s => {
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);
      const ra = consultantsMap.get(s.raId || s.raConsultantId);

      const wbGroup = getWhiteboardPhaseGroup(s.phase);
      const urgencyInfo = calculateUrgency(s, today);

      return {
        ...s,
        wbGroup,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca,
        raObj: ra,
        urgencyInfo
      };
    });

    const raActionSelections = enrichedSelections.filter(s => {
      if (s.phase === '内定辞退') return false;
      const uCode = s.urgencyInfo ? s.urgencyInfo.code : '';
      return (uCode === 'expired' || uCode === 'today' || uCode === 'waiting_reply' || uCode === 'ca_check' || uCode === 'within_3days');
    });

    const raSummary = {
      total: raActionSelections.length,
      expired: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'expired').length,
      today: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'today').length,
      companyWaiting: raActionSelections.filter(s => s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'waiting_reply')).length,
      caCheck: raActionSelections.filter(s => s.companyActionStatus === 'CA確認待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'ca_check')).length
    };

    let columns = [];
    if (selectedAxisMode === 'ca') {
      let targetCas = consultants.filter(c => {
        if (!c || c.isArchived || c.status === 'inactive') return false;
        if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
        return c.roleType === 'CA' || c.roleType === 'ADMIN' || c.role === 'CA' || !c.roleType;
      });

      if (targetCas.length === 0) targetCas = consultants;
      if (filterCaId) targetCas = targetCas.filter(c => c.consultantId === filterCaId);
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        targetCas = targetCas.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      const registeredCaIds = new Set(targetCas.map(c => c.consultantId));

      columns = targetCas.map(c => ({
        id: c.consultantId,
        title: `${c.name} (CA)`,
        filterFn: (s) => {
          if (s.caId && s.caId === c.consultantId) return true;
          if (s.caConsultantId && s.caConsultantId === c.consultantId) return true;
          if (s.caEmail && c.email && s.caEmail.toLowerCase() === c.email.toLowerCase()) return true;
          if (s.caName && c.name && s.caName.includes((c.name || '').split(' ')[0])) return true;
          return false;
        }
      }));

      // 指示書 9項: ID・メール・名前のどれでも判定できない案件は「担当CA未設定」列へ
      const hasUnassignedCa = enrichedSelections.some(s => {
        if (!s.caId && !s.caConsultantId && !s.caEmail && !s.caName) return true;
        return !columns.some(col => col.filterFn(s));
      });

      if (hasUnassignedCa) {
        columns.push({
          id: 'UNASSIGNED_CA',
          title: '担当CA未設定',
          filterFn: (s) => !columns.some(col => col.id !== 'UNASSIGNED_CA' && col.filterFn(s))
        });
      }
    } else {
      const activeCompanyIds = new Set(enrichedSelections.filter(s => s.phase !== '内定辞退').map(s => s.companyId));
      let targetCompanies = companies.filter(c => c && activeCompanyIds.has(c.companyId));
      if (filterCompanySearch) {
        const kw = filterCompanySearch.toLowerCase();
        targetCompanies = targetCompanies.filter(c => (c.name || '').toLowerCase().includes(kw));
      }
      columns = targetCompanies.map(c => ({
        id: c.companyId,
        title: c.name,
        filterFn: (s) => s.companyId === c.companyId
      }));
    }

    const sorted5Phases = [...WHITEBOARD_5PHASES].sort((a, b) => b.order - a.order);

    saveKanbanState({
      axisMode: selectedAxisMode,
      isRaAreaOpen,
      searchKeyword,
      filterCaId,
      filterCompanySearch,
      scrollTop: savedScrollY,
      scrollLeft: savedScrollLeft
    });

    container.innerHTML = `
      <div class="space-y-4">
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>
                ホワイトボード
              </h2>
              <span id="kanban-save-toast" class="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded opacity-0 transition-opacity">
                更新しました
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">全候補者の現在の選考進捗をCA別・企業別に俯瞰する画面です。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-wb-toggle-ca" class="px-4 py-1.5 rounded transition ${selectedAxisMode === 'ca' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">CA別</button>
              <button id="btn-wb-toggle-company" class="px-4 py-1.5 rounded transition ${selectedAxisMode === 'company' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">企業別</button>
            </div>
            ${selectedAxisMode === 'ca' ? `
              <input type="text" id="input-wb-ca-search" value="${searchKeyword}" placeholder="CA名で検索..." class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600">
            ` : `
              <input type="text" id="input-wb-comp-search" value="${filterCompanySearch}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600">
            `}
          </div>
        </div>

        <div class="bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div class="flex items-center space-x-3">
            <button id="btn-toggle-ra-summary" class="font-bold text-indigo-300 hover:text-white flex items-center gap-1.5 text-xs">
              <span>${isRaAreaOpen ? '▼' : '▶'}</span>
              <span class="text-sm font-black">本日のRA対応</span>
              <span class="bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[11px] px-2 py-0.5 rounded font-extrabold ml-1">
                ${raSummary.total} 件
              </span>
            </button>
          </div>
          ${isRaAreaOpen ? `
            <div class="flex flex-wrap items-center gap-3">
              <div id="ra-sum-click-expired" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">期限超過:</span>
                <strong class="text-rose-400 font-black ml-1 text-sm">${raSummary.expired}</strong>
              </div>
              <div id="ra-sum-click-today" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">本日対応:</span>
                <strong class="text-amber-400 font-black ml-1 text-sm">${raSummary.today}</strong>
              </div>
              <div id="ra-sum-click-waiting" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">企業回答待ち:</span>
                <strong class="text-sky-400 font-black ml-1 text-sm">${raSummary.companyWaiting}</strong>
              </div>
              <div id="ra-sum-click-check" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">要確認:</span>
                <strong class="text-purple-400 font-black ml-1 text-sm">${raSummary.caCheck}</strong>
              </div>
              <button id="btn-open-company-actions-page" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-lg text-xs transition shadow-sm border border-indigo-400 flex items-center gap-1.5 ml-2">
                <span>企業対応を開く</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-4 space-y-4">
          <div id="kanban-horizontal-scroll-container" class="overflow-x-auto w-full">
            <div class="space-y-4" style="min-width: max-content; width: 100%;">
              ${sorted5Phases.map((pObj) => {
                const groupSels = enrichedSelections.filter(s => {
                  if (s.phase === '内定辞退') {
                    const prevPhase = s.previousPhaseBeforeDecline || '内定';
                    return getWhiteboardPhaseGroup(prevPhase) === pObj.label;
                  }
                  return s.wbGroup === pObj.label;
                });
                const groupCases = groupSels.length;
                const groupPeople = calculateUniqueCandidatesCount(groupSels, false);
                const groupYomi = groupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                return `
                  <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50">
                    <div class="px-4 py-2 bg-slate-900 text-white flex items-center justify-between">
                      <div class="flex items-center space-x-3">
                        <span class="font-black text-sm text-indigo-200">${pObj.label}</span>
                        <span class="text-[11px] text-slate-400">（優先度: ${pObj.order}）</span>
                      </div>
                      <div class="flex items-center space-x-4 text-xs font-semibold">
                        <span>選考案件: <strong class="text-white">${groupCases}</strong>件</span>
                        <span class="text-slate-400">|</span>
                        <span>候補者実人数: <strong class="text-indigo-300">${groupPeople}</strong>名</span>
                        <span class="text-slate-400">|</span>
                        <span>ヨミ合計: <strong class="text-emerald-400">${Math.round(groupYomi * 100) / 100}</strong></span>
                      </div>
                    </div>
                    <div class="p-2 bg-slate-100/50 min-h-[130px]" style="display: grid; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); gap: 0.75rem;">
                      ${columns.length === 0 ? `
                        <div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">対象となる列データがありません</div>
                      ` : columns.map(col => {
                        const colGroupSels = groupSels.filter(s => col.filterFn(s));
                        const colYomi = colGroupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);
                        const colPeople = calculateUniqueCandidatesCount(colGroupSels, false);
                        return `
                          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
                            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                              <span class="font-extrabold text-xs text-slate-800 line-clamp-1">${col.title}</span>
                              <span class="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
                                案件:${colGroupSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
                              </span>
                            </div>
                            <div
                              class="kanban-drop-zone space-y-2 flex-1 min-h-[90px] p-1 rounded transition"
                              data-drop-group="${pObj.label}"
                              data-column-id="${col.id}"
                            >
                              ${colGroupSels.length === 0 ? `
                                <div class="h-full border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 py-6">
                                  案件なし
                                </div>
                              ` : colGroupSels.map(s => renderCaCardHTML(s, lastUpdatedSelectionId === s.selectionId, selectedAxisMode === 'company')).join('')}
                            </div>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const scrollContainer = container.querySelector('#kanban-horizontal-scroll-container');
    if (options.preserveScroll !== false) {
      setTimeout(() => {
        if (savedScrollY > 0) window.scrollTo({ top: savedScrollY, behavior: 'instant' });
        if (scrollContainer && savedScrollLeft > 0) scrollContainer.scrollLeft = savedScrollLeft;
      }, 0);
    }
    if (options.preserveFocusId) {
      const el = container.querySelector(`#${options.preserveFocusId}`);
      if (el) {
        el.focus();
        if (options.selectionStart !== undefined) el.setSelectionRange(options.selectionStart, options.selectionStart);
      }
    }

    container.querySelector('#btn-wb-toggle-ca')?.addEventListener('click', () => {
      selectedAxisMode = 'ca';
      saveKanbanState({ axisMode: 'ca' });
      updateView();
    });
    container.querySelector('#btn-wb-toggle-company')?.addEventListener('click', () => {
      selectedAxisMode = 'company';
      saveKanbanState({ axisMode: 'company' });
      updateView();
    });
    let isComposing = false;

    const caSearchEl = container.querySelector('#input-wb-ca-search');
    if (caSearchEl) {
      caSearchEl.addEventListener('compositionstart', () => { isComposing = true; });
      caSearchEl.addEventListener('compositionend', (e) => {
        isComposing = false;
        searchKeyword = e.target.value;
        saveKanbanState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wb-ca-search', selectionStart: e.target.selectionStart });
      });
      caSearchEl.addEventListener('input', (e) => {
        if (isComposing) return;
        searchKeyword = e.target.value;
        saveKanbanState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wb-ca-search', selectionStart: e.target.selectionStart });
      });
    }

    const compSearchEl = container.querySelector('#input-wb-comp-search');
    if (compSearchEl) {
      compSearchEl.addEventListener('compositionstart', () => { isComposing = true; });
      compSearchEl.addEventListener('compositionend', (e) => {
        isComposing = false;
        filterCompanySearch = e.target.value;
        saveKanbanState({ filterCompanySearch });
        updateView({ preserveFocusId: 'input-wb-comp-search', selectionStart: e.target.selectionStart });
      });
      compSearchEl.addEventListener('input', (e) => {
        if (isComposing) return;
        filterCompanySearch = e.target.value;
        saveKanbanState({ filterCompanySearch });
        updateView({ preserveFocusId: 'input-wb-comp-search', selectionStart: e.target.selectionStart });
      });
    }
    container.querySelector('#btn-toggle-ra-summary')?.addEventListener('click', () => {
      isRaAreaOpen = !isRaAreaOpen;
      saveKanbanState({ isRaAreaOpen });
      updateView({ preserveScroll: true });
    });
    container.querySelector('#btn-open-company-actions-page')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions();
    });
    container.querySelector('#ra-sum-click-expired')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('expired');
    });
    container.querySelector('#ra-sum-click-today')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('today');
    });
    container.querySelector('#ra-sum-click-waiting')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('waiting');
    });
    container.querySelector('#ra-sum-click-check')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions('ca_check');
    });

    container.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => {
        const selId = card.getAttribute('data-selection-id');
        saveKanbanState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        if (onOpenDetail) onOpenDetail(selId);
      });
    });

    let draggedSelectionId = null;
    let originColumnId = null;

    container.querySelectorAll('.kanban-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedSelectionId = card.getAttribute('data-selection-id');
        const parentZone = card.closest('.kanban-drop-zone');
        originColumnId = parentZone ? parentZone.getAttribute('data-column-id') : null;
        e.dataTransfer.setData('text/plain', draggedSelectionId);
        card.classList.add('opacity-40');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-40');
      });
    });

    container.querySelectorAll('.kanban-drop-zone').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;
        e.preventDefault();
        zone.classList.add('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
      });
      zone.addEventListener('drop', (e) => {
        const targetColId = zone.getAttribute('data-column-id');
        if (originColumnId && targetColId !== originColumnId) return;
        e.preventDefault();
        zone.classList.remove('bg-indigo-50/80', 'border-2', 'border-dashed', 'border-indigo-400');
        const targetGroup = zone.getAttribute('data-drop-group');
        if (draggedSelectionId && targetGroup) {
          const selection = store.getSelections().find(s => s.selectionId === draggedSelectionId);
          if (selection) {
            handlePhaseDropWithDialog(selection, targetGroup, (newPhase) => {
              try {
                lastUpdatedSelectionId = draggedSelectionId;
                store.updateSelection(draggedSelectionId, { phase: newPhase }, 'ホワイトボードでのドラッグ＆ドロップ更新');
                updateView({ preserveScroll: true });
              } catch (err) {
                alert('保存に失敗しました。');
              }
            });
          }
        }
      });
    });
  }

  updateView({ preserveScroll: true });
}

function renderCaCardHTML(s, isHighlighted, isCompanyAxis) {
  const isDeclined = s.phase === '内定辞退';
  const uObj = s.urgencyInfo || {};
  const percentStr = Math.round((Number(s.yomi) || 0) * 100) + '%';
  return `
    <div
      draggable="${isDeclined ? 'false' : 'true'}"
      data-selection-id="${s.selectionId}"
      class="kanban-card rounded-lg p-2.5 shadow-2xs transition space-y-1.5 border text-xs ${
        isDeclined
          ? 'bg-slate-200/80 border-slate-300 text-slate-500 cursor-default opacity-75'
          : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-400 cursor-grab active:cursor-grabbing group'
      } ${isHighlighted ? 'ring-4 ring-indigo-500 border-indigo-500 font-semibold shadow-md' : ''}"
    >
      <div class="flex items-center justify-between gap-1 border-b border-slate-100 pb-1">
        <div class="font-extrabold text-xs text-slate-900 truncate group-hover:text-indigo-600 transition" title="${s.candidateObj ? s.candidateObj.name : s.candidateName}">
          ${s.candidateObj ? s.candidateObj.name : s.candidateName} 様
        </div>
        ${isDeclined ? `
          <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-slate-500 text-white shrink-0">内定辞退</span>
        ` : (uObj.code === 'expired' || uObj.code === 'today') ? `
          <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold ${uObj.badgeClass} shrink-0">${uObj.label}</span>
        ` : ''}
      </div>
      <div class="text-[10px] text-slate-700 truncate">
        ${isCompanyAxis ? `CA: <strong class="text-indigo-900 font-bold">${s.caObj ? (s.caObj.name || '').split(' ')[0] : s.caName || '-'}</strong>` : `<strong class="text-slate-900 font-bold">${s.companyObj ? s.companyObj.name : s.companyName}</strong>`}
      </div>
      <div class="text-[10px] text-slate-500 truncate" title="${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}">
        ${s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName}
      </div>
      <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
        <div class="font-bold text-indigo-800 truncate">${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span></div>
        <div class="font-black text-slate-900 shrink-0 ml-1">ヨミ ${percentStr}</div>
      </div>
    </div>
  `;
}

function handlePhaseDropWithDialog(selection, targetGroupLabel, onConfirm) {
  if (targetGroupLabel === '最終・二次') {
    const dialog = createOptionsDialog('「最終・二次」フェーズへ移動', '移動先の実フェーズを選択してください:', [
      { label: '二次面接', phase: '二次面接' },
      { label: '三次面接', phase: '三次面接' },
      { label: '最終面接', phase: '最終面接' }
    ], onConfirm);
    document.body.appendChild(dialog);
  } else if (targetGroupLabel === '内定') {
    const dialog = createOptionsDialog('「内定」フェーズへ移動', '移動先の実フェーズを選択してください:', [
      { label: '内定', phase: '内定' },
      { label: 'オファー面談・条件提示', phase: 'オファー面談・条件提示' }
    ], onConfirm);
    document.body.appendChild(dialog);
  } else if (targetGroupLabel === '一次') {
    onConfirm('一次面接');
  } else if (targetGroupLabel === '内定承諾') {
    onConfirm('内定承諾');
  } else if (targetGroupLabel === '書類選考') {
    onConfirm('書類選考');
  } else {
    onConfirm('書類選考');
  }
}

function createOptionsDialog(title, message, optionsList, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 text-xs';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-sm space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-2">
        <h3 class="font-bold text-slate-900 text-sm">${title}</h3>
        <button id="btn-cancel-phase-dialog" class="text-slate-400 hover:text-slate-700 font-bold text-base">✕</button>
      </div>

      <p class="text-slate-700 font-medium">${message}</p>

      <div class="space-y-2">
        ${optionsList.map(opt => `
          <button class="btn-select-phase-option w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-900 font-bold rounded-lg border border-indigo-200 transition text-left flex items-center justify-between" data-phase="${opt.phase}">
            <span>${opt.label}</span>
            <span class="text-xs">➔</span>
          </button>
        `).join('')}
      </div>

      <div class="pt-2 text-right">
        <button id="btn-cancel-phase-dialog-bottom" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded">キャンセル</button>
      </div>
    </div>
  `;

  const closeDialog = () => modal.remove();

  modal.querySelector('#btn-cancel-phase-dialog')?.addEventListener('click', closeDialog);
  modal.querySelector('#btn-cancel-phase-dialog-bottom')?.addEventListener('click', closeDialog);

  modal.querySelectorAll('.btn-select-phase-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedPhase = btn.getAttribute('data-phase');
      closeDialog();
      onConfirm(selectedPhase);
    });
  });

  return modal;
}

/**
 * 「連絡済みにする」ポップアップダイアログ (指示書 20項)
 */
function openContactedModal(selectionId, onComplete) {
  let modal = document.getElementById('contacted-modal');
  if (modal) modal.remove();

  const selections = store.getSelections();
  const selection = selections.find(s => s.selectionId === selectionId);
  if (!selection) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultNextDate = new Date();
  defaultNextDate.setDate(defaultNextDate.getDate() + 2);
  const defaultNextStr = defaultNextDate.toISOString().slice(0, 10);

  modal = document.createElement('div');
  modal.id = 'contacted-modal';
  modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 text-xs';

  modal.innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 w-full max-w-md space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="font-bold text-slate-900 text-sm">連絡済み登録 - ${selection.candidateName} 様 (${selection.companyName})</h3>
        <button id="btn-close-contacted" class="text-slate-400 hover:text-slate-700 font-bold text-base">✕</button>
      </div>

      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block font-bold text-slate-700 mb-1">連絡日</label>
            <input type="date" id="contact-date" value="${todayStr}" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-mono">
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">連絡方法</label>
            <select id="contact-method" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-bold">
              <option value="メール">メール</option>
              <option value="電話">電話</option>
              <option value="Teams">Teams</option>
              <option value="Zoom">Zoom</option>
              <option value="その他">その他</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">企業対応ステータス</label>
          <select id="contact-status" class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 font-bold text-indigo-900">
            <option value="企業へ連絡済み">企業へ連絡済み</option>
            <option value="企業回答待ち">企業回答待ち</option>
            <option value="CA確認待ち">CA確認待ち</option>
            <option value="完了">完了</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">次回確認予定日</label>
          <input type="date" id="next-contact-date" value="${defaultNextStr}" class="w-full bg-white border border-indigo-300 rounded px-2 py-1 font-mono font-bold text-indigo-900">
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">連絡内容メモ</label>
          <input type="text" id="contact-memo" placeholder="連絡内容を入力..." class="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1">
        </div>
      </div>

      <div class="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
        <button id="btn-cancel-contacted" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded font-semibold text-slate-700">キャンセル</button>
        <button id="btn-save-contacted" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded shadow">連絡済みに登録</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#btn-close-contacted')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-cancel-contacted')?.addEventListener('click', () => modal.remove());

  modal.querySelector('#btn-save-contacted')?.addEventListener('click', () => {
    const cStatus = modal.querySelector('#contact-status').value;
    const nextDate = modal.querySelector('#next-contact-date').value;
    const memo = modal.querySelector('#contact-memo').value;

    store.updateSelection(selectionId, {
      companyActionStatus: cStatus,
      nextCompanyContactDate: nextDate || null,
      actionDeadline: nextDate || null
    }, 'ホワイトボードからの連絡済み登録');

    store.addCompanyCommunication({
      companyId: selection.companyId,
      selectionIds: [selectionId],
      communicationType: '連絡済み登録',
      method: modal.querySelector('#contact-method').value,
      notes: memo,
      status: cStatus
    });

    modal.remove();
    if (onComplete) onComplete();
  });
}


/**
 * 選考進捗・ヨミ管理システム - 新ホワイトボード画面コンポーネント (WhiteboardV2)
 * 指示書 (全26項) に厳格準拠し、「企業対応」と同じ正常データソースを使用してゼロから堅牢再構築
 */






const WHITEBOARD_V2_STORAGE_KEY = 'whiteboard_v2_state_v1';

function getSavedState() {
  try {
    const raw = sessionStorage.getItem(WHITEBOARD_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveState(state) {
  try {
    const current = getSavedState();
    sessionStorage.setItem(WHITEBOARD_V2_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

/**
 * 新フェーズマッピング関数 (指示書 10項)
 */
function mapPhaseToWhiteboardGroup(phase) {
  const p = (phase || '').trim();

  // 1. 内定承諾
  if (['内定承諾', '承諾', '入社予定', '入社日確定', '承諾後手続き', '入社手続き中'].includes(p)) {
    return '内定承諾';
  }
  // 2. 内定
  if (['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整', '内定回答待ち', '候補者回答待ち'].includes(p)) {
    return '内定';
  }
  // 3. 最終・二次
  if (['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接'].includes(p)) {
    return '最終・二次';
  }
  // 4. 一次
  if (['一次面接', '一次選考', '一次面談', '一次面接日程調整', '一次面接結果待ち'].includes(p)) {
    return '一次';
  }
  // 5. 書類選考
  if (['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち'].includes(p)) {
    return '書類選考';
  }

  // デフォルトフォールバック (指示書 11項)
  return getWhiteboardPhaseGroup(p) || '書類選考';
}

function renderWhiteboardV2(container, { onOpenDetail, onNavigateToCompanyActions }) {
  const savedState = getSavedState();

  let axisMode = savedState.axisMode || 'ca'; // 'ca' または 'company'
  let searchKeyword = savedState.searchKeyword || '';
  let isRaSummaryOpen = savedState.isRaSummaryOpen !== undefined ? savedState.isRaSummaryOpen : true;
  let isComposing = false;

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    // 指示書 3, 4項: 「企業対応」と同じデータ取得処理をそのまま利用
    const selections = store.getSelections() || [];
    const companies = store.getCompanies() || [];
    const jobs = store.getJobs() || [];
    const candidates = store.getCandidates() || [];
    const consultants = store.getConsultants() || [];

    const isLoading = store.isLoading ? store.isLoading() : false;
    if (isLoading) {
      container.innerHTML = `
        <div class="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
          <p class="text-slate-700 font-bold text-sm">選考案件を読み込んでいます...</p>
        </div>
      `;
      return;
    }

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 指示書 6, 12項: 進行中の全選考案件を対象とし、終了案件だけを除外
    const activeSelections = selections.filter(s => {
      if (!s || s.isArchived || s.isDeleted) return false;
      const p = s.phase || '';
      return p !== '選考終了' && p !== '書類見送り' && p !== '面接見送り' && p !== '候補者辞退' && p !== '他社決定';
    });

    const enrichedSelections = activeSelections.map(s => {
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);
      const ra = consultantsMap.get(s.raId || s.raConsultantId);

      const wbGroup = mapPhaseToWhiteboardGroup(s.phase);
      const urgencyInfo = calculateUrgency(s, today);

      return {
        ...s,
        wbGroup,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca,
        raObj: ra,
        urgencyInfo
      };
    });

    // RAサマリー集計 (指示書 16項)
    const raActionSelections = enrichedSelections.filter(s => {
      if (s.phase === '内定辞退') return false;
      const uCode = s.urgencyInfo ? s.urgencyInfo.code : '';
      return (uCode === 'expired' || uCode === 'today' || uCode === 'waiting_reply' || uCode === 'ca_check' || uCode === 'within_3days');
    });

    const raSummary = {
      total: raActionSelections.length,
      expired: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'expired').length,
      today: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'today').length,
      companyWaiting: raActionSelections.filter(s => s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'waiting_reply')).length,
      caCheck: raActionSelections.filter(s => s.companyActionStatus === 'CA確認待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'ca_check')).length
    };

    // 列（横軸）の決定 (指示書 6, 8, 9, 13項)
    let columns = [];
    if (axisMode === 'ca') {
      let targetCas = consultants.filter(c => {
        if (!c || c.isArchived || c.status === 'inactive') return false;
        if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
        return c.roleType === 'CA' || c.roleType === 'ADMIN' || c.role === 'CA' || !c.roleType;
      });

      if (targetCas.length === 0) targetCas = consultants;

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        targetCas = targetCas.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      columns = targetCas.map(c => ({
        id: c.consultantId,
        title: `${c.name} (CA)`,
        filterFn: (s) => {
          if (s.caId && s.caId === c.consultantId) return true;
          if (s.caConsultantId && s.caConsultantId === c.consultantId) return true;
          if (s.caEmail && c.email && s.caEmail.toLowerCase() === c.email.toLowerCase()) return true;
          if (s.caName && c.name && s.caName.includes((c.name || '').split(' ')[0])) return true;
          return false;
        }
      }));

      // 担当CA未設定案件の救済列 (指示書 9項)
      const hasUnassigned = enrichedSelections.some(s => !columns.some(col => col.filterFn(s)));
      if (hasUnassigned) {
        columns.push({
          id: 'UNASSIGNED_CA',
          title: '担当CA未設定',
          filterFn: (s) => !columns.some(col => col.id !== 'UNASSIGNED_CA' && col.filterFn(s))
        });
      }
    } else {
      // 企業別表示: 進行中案件が存在する企業のみ
      const activeCompanyIds = new Set(enrichedSelections.filter(s => s.phase !== '内定辞退').map(s => s.companyId));
      let targetCompanies = companies.filter(c => c && activeCompanyIds.has(c.companyId));

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        targetCompanies = targetCompanies.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      columns = targetCompanies.map(c => ({
        id: c.companyId,
        title: c.name,
        filterFn: (s) => s.companyId === c.companyId
      }));
    }

    // 縦軸 5フェーズ (指示書 7項: 必ず固定表示)
    const sorted5Phases = [...WHITEBOARD_5PHASES].sort((a, b) => b.order - a.order);

    saveState({
      axisMode,
      searchKeyword,
      isRaSummaryOpen
    });

    // グリッドHTMLの組み立て (指示書 8, 9, 12, 14, 25項)
    const gridHTML = columns.length === 0 ? `
      <div class="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-500 font-bold text-sm">
        ${axisMode === 'ca' ? '該当するCAがありません' : '該当する企業がありません'}
      </div>
    ` : sorted5Phases.map(pObj => {
      const groupSels = enrichedSelections.filter(s => {
        if (s.phase === '内定辞退') {
          const prevPhase = s.previousPhaseBeforeDecline || '内定';
          return mapPhaseToWhiteboardGroup(prevPhase) === pObj.label;
        }
        return s.wbGroup === pObj.label;
      });

      const groupCases = groupSels.length;
      const groupPeople = calculateUniqueCandidatesCount(groupSels, false);
      const groupYomi = groupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);

      const colsHTML = columns.map(col => {
        const colSels = groupSels.filter(s => col.filterFn(s));
        const colPeople = calculateUniqueCandidatesCount(colSels, false);
        const colYomi = colSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);

        const cardsHTML = colSels.length === 0 ? `
          <div class="h-full border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 py-6">
            案件なし
          </div>
        ` : colSels.map(s => renderCandidateCardHTML(s, axisMode === 'company')).join('');

        return `
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
              <span class="font-extrabold text-xs text-slate-800 line-clamp-1">${col.title}</span>
              <span class="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
                案件:${colSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
              </span>
            </div>
            <div class="space-y-2 flex-1 min-h-[90px] p-1">
              ${cardsHTML}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50">
          <div class="px-4 py-2 bg-slate-900 text-white flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="font-black text-sm text-indigo-200">${pObj.label}</span>
              <span class="text-[11px] text-slate-400">（優先度: ${pObj.order}）</span>
            </div>
            <div class="flex items-center space-x-4 text-xs font-semibold">
              <span>選考案件: <strong class="text-white">${groupCases}</strong>件</span>
              <span class="text-slate-400">|</span>
              <span>候補者実人数: <strong class="text-indigo-300">${groupPeople}</strong>名</span>
              <span class="text-slate-400">|</span>
              <span>ヨミ合計: <strong class="text-emerald-400">${Math.round(groupYomi * 100) / 100}</strong></span>
            </div>
          </div>
          <div class="p-2 bg-slate-100/50 min-h-[130px]" style="display: grid; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); gap: 0.75rem;">
            ${colsHTML}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="space-y-4">
        <!-- ヘッダー ＆ 切替 ＆ 検索 (指示书 17, 18, 25項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>
              ホワイトボード (V2)
            </h2>
            <p class="text-xs text-slate-500 mt-1">全進行案件の選考進捗をCA別・企業別に俯瞰する画面です。（進行案件: ${activeSelections.length}件）</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-wbv2-toggle-ca" class="px-4 py-1.5 rounded transition ${axisMode === 'ca' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">CA別</button>
              <button id="btn-wbv2-toggle-company" class="px-4 py-1.5 rounded transition ${axisMode === 'company' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">企業別</button>
            </div>

            <input type="text" id="input-wbv2-search" value="${searchKeyword}" placeholder="${axisMode === 'ca' ? 'CA名で検索...' : '企業名で検索...'}" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600">
          </div>
        </div>

        <!-- 本日のRA対応コンパクトバナー (指示書 16項) -->
        <div class="bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div class="flex items-center space-x-3">
            <button id="btn-wbv2-toggle-ra" class="font-bold text-indigo-300 hover:text-white flex items-center gap-1.5 text-xs">
              <span>${isRaSummaryOpen ? '▼' : '▶'}</span>
              <span class="text-sm font-black">本日のRA対応</span>
              <span class="bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[11px] px-2 py-0.5 rounded font-extrabold ml-1">
                ${raSummary.total} 件
              </span>
            </button>
          </div>
          ${isRaSummaryOpen ? `
            <div class="flex flex-wrap items-center gap-3">
              <div id="ra-click-expired" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">期限超過:</span>
                <strong class="text-rose-400 font-black ml-1 text-sm">${raSummary.expired}</strong>
              </div>
              <div id="ra-click-today" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">本日対応:</span>
                <strong class="text-amber-400 font-black ml-1 text-sm">${raSummary.today}</strong>
              </div>
              <div id="ra-click-waiting" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">企業回答待ち:</span>
                <strong class="text-sky-400 font-black ml-1 text-sm">${raSummary.companyWaiting}</strong>
              </div>
              <div id="ra-click-check" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">要確認:</span>
                <strong class="text-purple-400 font-black ml-1 text-sm">${raSummary.caCheck}</strong>
              </div>

              <button id="btn-wbv2-open-company-actions" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-lg text-xs transition shadow-sm border border-indigo-400 flex items-center gap-1.5 ml-2">
                <span>企業対応を開く</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <!-- 5区分ボード領域 -->
        <div id="wbv2-horizontal-scroll-container" class="overflow-x-auto w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="space-y-4" style="min-width: max-content; width: 100%;">
            ${gridHTML}
          </div>
        </div>
      </div>
    `;

    if (savedScrollY > 0) window.scrollTo(0, savedScrollY);

    if (options.preserveFocusId) {
      const inputEl = container.querySelector('#' + options.preserveFocusId);
      if (inputEl) {
        inputEl.focus();
        if (options.selectionStart !== undefined) inputEl.setSelectionRange(options.selectionStart, options.selectionStart);
      }
    }

    // イベントバインド
    container.querySelector('#btn-wbv2-toggle-ca')?.addEventListener('click', () => {
      axisMode = 'ca';
      saveState({ axisMode: 'ca' });
      updateView();
    });

    container.querySelector('#btn-wbv2-toggle-company')?.addEventListener('click', () => {
      axisMode = 'company';
      saveState({ axisMode: 'company' });
      updateView();
    });

    // 日本語IME保護付き検索イベント (指示書 17, 18項)
    const searchEl = container.querySelector('#input-wbv2-search');
    if (searchEl) {
      searchEl.addEventListener('compositionstart', () => { isComposing = true; });
      searchEl.addEventListener('compositionend', (e) => {
        isComposing = false;
        searchKeyword = e.target.value;
        saveState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wbv2-search', selectionStart: e.target.selectionStart });
      });
      searchEl.addEventListener('input', (e) => {
        if (isComposing) return;
        searchKeyword = e.target.value;
        saveState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wbv2-search', selectionStart: e.target.selectionStart });
      });
    }

    container.querySelector('#btn-wbv2-toggle-ra')?.addEventListener('click', () => {
      isRaSummaryOpen = !isRaSummaryOpen;
      saveState({ isRaSummaryOpen });
      updateView({ preserveScroll: true });
    });

    container.querySelector('#btn-wbv2-open-company-actions')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions();
    });

    container.querySelectorAll('.wbv2-card-click').forEach(card => {
      card.addEventListener('click', () => {
        const selId = card.getAttribute('data-selection-id');
        if (selId && onOpenDetail) onOpenDetail(selId);
      });
    });
  }

  updateView();
}

/**
 * 候補者カードHTML生成関数 (指示書 12, 14項)
 */
function renderCandidateCardHTML(s, isCompanyAxis) {
  const isDeclined = s.phase === '内定辞退';
  const uObj = s.urgencyInfo || {};
  const percentStr = Math.round((Number(s.yomi) || 0) * 100) + '%';
  const candName = s.candidateObj ? s.candidateObj.name : s.candidateName;
  const compName = s.companyObj ? s.companyObj.name : s.companyName;
  const jobTitle = s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName;
  const caName = s.caObj ? (s.caObj.name || '').split(' ')[0] : s.caName || '-';

  return `
    <div
      data-selection-id="${s.selectionId}"
      class="wbv2-card-click kanban-card rounded-lg p-2.5 shadow-2xs transition space-y-1.5 border text-xs cursor-pointer ${
        isDeclined
          ? 'bg-slate-200/80 border-slate-300 text-slate-500 cursor-default opacity-75'
          : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-400 group'
      }"
    >
      <div class="flex items-center justify-between gap-1 border-b border-slate-100 pb-1">
        <div class="font-extrabold text-xs text-slate-900 truncate group-hover:text-indigo-600 transition" title="${candName}">
          ${candName} 様
        </div>
        ${isDeclined ? `
          <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-slate-500 text-white shrink-0">内定辞退</span>
        ` : (uObj.code === 'expired' || uObj.code === 'today') ? `
          <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold ${uObj.badgeClass} shrink-0">${uObj.label}</span>
        ` : ''}
      </div>

      <div class="text-[10px] text-slate-700 truncate">
        ${isCompanyAxis ? `CA: <strong class="text-indigo-900 font-bold">${caName}</strong>` : `<strong class="text-slate-900 font-bold">${compName}</strong>`}
      </div>

      <div class="text-[10px] text-slate-500 truncate" title="${jobTitle}">
        ${jobTitle}
      </div>

      <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
        <div class="font-bold text-indigo-800 truncate">${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span></div>
        <div class="font-black text-slate-900 shrink-0 ml-1">ヨミ ${percentStr}</div>
      </div>
    </div>
  `;
}


/**
 * 選考進捗・ヨミ管理システム - CA用画面コンポーネント (担当候補者 & 進行中案件絞り込み対応)
 */




function renderCaView(container, { onOpenDetail }) {
  const currentCons = store.getCurrentConsultant();
  let filterCaId = currentCons.roleType === 'CA' ? currentCons.consultantId : '';
  let searchCandName = '';
  let filterPhase = '';
  let filterOnlyMine = currentCons.roleType === 'CA';
  let filterHasOffer = false;
  let filterMultiApply = false;
  let showEndedSelections = false;

  function updateView() {
    const candidates = store.getCandidates();
    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const consultants = store.getConsultants();

    const caConsultants = consultants.filter(c => c.roleType === 'CA' || c.roleType === 'ADMIN');

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const candidateCards = candidates.map(cand => {
      const candSelections = selections.filter(s => !s.isArchived && s.candidateId === cand.candidateId);
      const activeSelections = candSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const hasOffer = activeSelections.some(s => s.phase === '内定' || s.phase === 'オファー面談・条件提示' || s.phase === '内定承諾' || s.phase === '入社予定');
      const caCons = consultantsMap.get(cand.caId || cand.caConsultantId);

      const displaySelections = showEndedSelections ? candSelections : activeSelections;

      return {
        candidate: cand,
        caConsultant: caCons,
        allSelections: candSelections,
        activeSelections,
        displaySelections,
        entryCount: candSelections.length,
        inProgressCount: activeSelections.length,
        hasOffer,
        isMultiApply: activeSelections.length > 1
      };
    });

    let filtered = candidateCards.filter(card => {
      if (card.candidate.isArchived) return false;

      if (filterOnlyMine && card.candidate.caId !== currentCons.consultantId) return false;
      if (filterCaId && card.candidate.caId !== filterCaId) return false;

      if (searchCandName) {
        const kw = searchCandName.toLowerCase();
        const name = (card.candidate.name || '').toLowerCase();
        const kana = (card.candidate.kana || '').toLowerCase();
        if (!name.includes(kw) && !kana.includes(kw)) return false;
      }

      if (filterPhase && !card.displaySelections.some(s => s.phase === filterPhase)) return false;
      if (filterHasOffer && !card.hasOffer) return false;
      if (filterMultiApply && !card.isMultiApply) return false;

      return true;
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 画面ヘッダー -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              CA管理画面
            </h2>
            <p class="text-xs text-slate-500 mt-1">※書類・面接見送りおよび内定辞退案件は通常の対話確認対象から除外されています。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-ca-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-600">
              <span>自分の担当候補者のみ表示</span>
            </label>

            <select id="select-ca-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              <option value="">すべてのCA担当</option>
              ${caConsultants.map(c => `<option value="${c.consultantId}" ${filterCaId === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- 本日のCA対応 サマリー (指示書 11項) -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div class="bg-rose-50/70 p-3 rounded-lg border border-rose-200 cursor-pointer hover:bg-rose-100 transition" id="ca-sum-overdue">
            <div class="text-[11px] font-extrabold text-rose-800">期限超過</div>
            <div class="text-xl font-black text-rose-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => getSelectionAlerts(s).isOverdue)).length}<span class="text-xs font-normal text-rose-700 ml-1">件</span></div>
          </div>
          <div class="bg-amber-50/70 p-3 rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-100 transition" id="ca-sum-contact">
            <div class="text-[11px] font-extrabold text-amber-800">候補者連絡</div>
            <div class="text-xl font-black text-amber-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => s.currentBall === 'CA')).length}<span class="text-xs font-normal text-amber-700 ml-1">件</span></div>
          </div>
          <div class="bg-indigo-50/70 p-3 rounded-lg border border-indigo-200 cursor-pointer hover:bg-indigo-100 transition" id="ca-sum-dates">
            <div class="text-[11px] font-extrabold text-indigo-800">候補日確認</div>
            <div class="text-xl font-black text-indigo-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => (s.nextAction || '').includes('候補日'))).length}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
          </div>
          <div class="bg-purple-50/70 p-3 rounded-lg border border-purple-200 cursor-pointer hover:bg-purple-100 transition" id="ca-sum-intent">
            <div class="text-[11px] font-extrabold text-purple-800">意向確認</div>
            <div class="text-xl font-black text-purple-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => (s.nextAction || '').includes('意向'))).length}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
          </div>
          <div class="bg-emerald-50/70 p-3 rounded-lg border border-emerald-200 cursor-pointer hover:bg-emerald-100 transition" id="ca-sum-ra-reply">
            <div class="text-[11px] font-extrabold text-emerald-800">RAから回答あり</div>
            <div class="text-xl font-black text-emerald-600 mt-1">${filtered.filter(c => c.activeSelections.some(s => s.companyActionStatus === 'CA確認待ち')).length}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
          </div>
        </div>

        <!-- 検索 & フィルター (指示書 9項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3 text-xs">
          <input type="text" id="input-ca-search-kw" value="${searchCandName}" placeholder="候補者名 / フリガナで検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="checkbox" id="chk-ca-has-offer" ${filterHasOffer ? 'checked' : ''} class="rounded text-emerald-600">
            <span class="font-semibold text-emerald-800">内定ありのみ</span>
          </label>

          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="checkbox" id="chk-ca-multi-apply" ${filterMultiApply ? 'checked' : ''} class="rounded text-purple-600">
            <span class="font-semibold text-purple-800">複数社選考中のみ</span>
          </label>

          <label class="inline-flex items-center space-x-1.5 cursor-pointer ml-auto bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
            <input type="checkbox" id="chk-ca-show-ended" ${showEndedSelections ? 'checked' : ''} class="rounded text-indigo-600">
            <span class="font-bold text-slate-700">過去の終了案件を含む</span>
          </label>
        </div>

        <!-- 候補者グループカードリスト -->
        <div class="space-y-4">
          ${filtered.length === 0 ? `
            <div class="bg-white p-12 text-center text-slate-400 rounded-xl border border-slate-200">
              条件に該当する担当候補者が存在しません。
            </div>
          ` : filtered.map(card => {
            const cand = card.candidate;
            const ca = card.caConsultant;

            return `
              <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <!-- 候補者基本情報バー -->
                <div class="bg-slate-900 text-white px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800">
                  <div class="flex items-center space-x-3">
                    <h3 class="text-base font-bold text-white">${cand.name}</h3>
                    <span class="text-xs text-slate-400 font-normal">(${cand.kana || ''})</span>
                    <span class="text-[11px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono">${cand.internalManagementNumber || ''}</span>
                    ${card.isMultiApply ? `<span class="text-[10px] bg-purple-500/30 text-purple-300 border border-purple-400/30 px-2 py-0.5 rounded font-bold">複数社選考中 (${card.inProgressCount}社)</span>` : ''}
                    ${card.hasOffer ? `<span class="text-[10px] bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded font-bold">内定あり</span>` : ''}
                  </div>

                  <div class="flex items-center space-x-4 text-xs text-slate-300">
                    <span>担当CA: <strong class="text-white">${ca ? ca.name : '未設定'}</strong></span>
                    <span>活動状況: <strong class="text-indigo-300">${cand.activityStatus || '選考中'}</strong></span>
                    <span>進行中案件: <strong class="text-emerald-400">${card.inProgressCount}</strong>社</span>
                  </div>
                </div>

                <!-- 候補者の応募先選考一覧 -->
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th class="px-4 py-2.5">応募先企業</th>
                        <th class="px-4 py-2.5">求人・ポジション</th>
                        <th class="px-3 py-2.5">担当RA</th>
                        <th class="px-3 py-2.5">選考フェーズ</th>
                        <th class="px-3 py-2.5">進行状態</th>
                        <th class="px-3 py-2.5 text-right">ヨミ</th>
                        <th class="px-3 py-2.5">次回予定日</th>
                        <th class="px-3 py-2.5">警告</th>
                        <th class="px-3 py-2.5 text-center">詳細</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      ${card.displaySelections.length === 0 ? `
                        <tr><td colspan="9" class="text-center py-4 text-slate-400">現在確認対象の進行中選考案件はありません。</td></tr>
                      ` : card.displaySelections.map(s => {
                        const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                        const comp = companiesMap.get(s.companyId);
                        const job = jobsMap.get(s.jobId);
                        const ra = consultantsMap.get(s.raId || s.raConsultantId);
                        const alerts = getSelectionAlerts(s, comp);

                        return `
                          <tr class="${isEnded ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-indigo-50/30'} transition">
                            <td class="px-4 py-2.5 font-bold text-slate-900">
                              <div>${comp ? comp.name : s.companyName}</div>
                              <div class="text-[10px] text-indigo-700 font-semibold mt-0.5">次行動: ${s.nextAction || '候補者連絡'}</div>
                            </td>
                            <td class="px-4 py-2.5 text-slate-700">${job ? (job.title || job.jobName) : s.jobName}</td>
                            <td class="px-3 py-2.5 text-slate-600">${ra ? ra.name.split(' ')[0] : s.raName || '-'}</td>
                            <td class="px-3 py-2.5 font-bold">
                              ${s.phase === '内定辞退' ? '<span class="px-2 py-0.5 bg-slate-500 text-white rounded text-[10px]">内定辞退</span>' : (s.phase === '選考終了' ? '<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px]">選考終了</span>' : `<span class="text-indigo-700">${s.phase}</span>`)}
                            </td>
                            <td class="px-3 py-2.5 text-slate-700">${s.progressStatus}</td>
                            <td class="px-3 py-2.5 text-right font-black ${isEnded ? 'text-slate-400' : 'text-indigo-600'}">${isEnded ? '0%' : (s.yomi * 100 + '%')}</td>
                            <td class="px-3 py-2.5 text-slate-600">${s.nextScheduleDate || '-'}</td>
                            <td class="px-3 py-2.5">
                              <div class="flex flex-wrap gap-1">
                                ${alerts.map(a => `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${a.level === 'red' ? 'bg-rose-100 text-rose-800' : 'bg-orange-100 text-orange-800'}">${a.message}</span>`).join('')}
                              </div>
                            </td>
                            <td class="px-3 py-2.5 text-center">
                              <div class="flex items-center justify-end space-x-1">
                                <button data-ca-action="CONTACTED" data-id="${s.selectionId}" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-bold">連絡済</button>
                                <button data-ca-action="GOT_DATES" data-id="${s.selectionId}" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold">候補日取得</button>
                                <button data-ca-action="ACCEPT_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold">承諾意向</button>
                                <button data-ca-action="DECLINE_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold">辞退意向</button>
                                <button class="btn-ca-detail px-2 py-0.5 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[10px] font-bold transition" data-id="${s.selectionId}">詳細</button>
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // イベントバインド
    container.querySelector('#chk-ca-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView(); });
    container.querySelector('#select-ca-filter')?.addEventListener('change', (e) => { filterCaId = e.target.value; updateView(); });
    container.querySelector('#input-ca-search-kw')?.addEventListener('input', (e) => { searchCandName = e.target.value; updateView(); });
    container.querySelector('#chk-ca-has-offer')?.addEventListener('change', (e) => { filterHasOffer = e.target.checked; updateView(); });
    container.querySelector('#chk-ca-multi-apply')?.addEventListener('change', (e) => { filterMultiApply = e.target.checked; updateView(); });
    container.querySelector('#chk-ca-show-ended')?.addEventListener('change', (e) => { showEndedSelections = e.target.checked; updateView(); });

    container.querySelectorAll('button[data-ca-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-ca-action');
        store.handleCaAction(selId, act);
        updateView();
      });
    });

    container.querySelectorAll('.btn-ca-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}


/**
 * 選考進捗・ヨミ管理システム - RA用画面コンポーネント (担当企業管理 & 選考終了・内定辞退集計除外対応)
 */





const RA_STORAGE_KEY = 'ra_view_active_state';

function getSavedRaState() {
  try {
    const raw = sessionStorage.getItem(RA_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveRaState(state) {
  try {
    const current = getSavedRaState();
    sessionStorage.setItem(RA_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderRaView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedRaState();

  let filterRaId = savedState.filterRaId !== undefined ? savedState.filterRaId : (currentCons.roleType === 'RA' ? currentCons.consultantId : '');
  let filterOnlyMine = savedState.filterOnlyMine !== undefined ? savedState.filterOnlyMine : (currentCons.roleType === 'RA');
  let searchCompName = savedState.searchCompName || '';
  let filterRank = savedState.filterRank || '';
  let filterHasWaiting = savedState.filterHasWaiting || false;
  let filterHasRemind = savedState.filterHasRemind || false;
  let sortBy = savedState.sortBy || 'rank_desc';
  let openCompanyIds = new Set(savedState.openCompanyIds || []);
  let showEndedSelections = savedState.showEndedSelections || {}; // { companyId: boolean }

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const companies = store.getCompanies();
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();

    const raConsultants = consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN');
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 企業ごとの集計・案件作成 (選考終了および内定辞退は進行中集計から除外) (指示書 10項)
    const companyCards = companies.map(comp => {
      const compSelections = selections.filter(s => !s.isArchived && s.companyId === comp.companyId);
      const activeSelections = compSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const waitingCount = activeSelections.filter(s => s.progressStatus === '実施済み・結果待ち').length;
      const remindCount = activeSelections.filter(s => s.companyActionStatus === '未対応' || s.companyActionStatus === '催促中' || (s.actionDeadline && new Date(s.actionDeadline) < today)).length;
      const reportCount = activeSelections.filter(s => s.companyActionType && s.companyActionStatus !== '完了').length;
      const yomiTotal = activeSelections.reduce((sum, s) => sum + Number(s.yomi || 0), 0);
      const uniquePeople = calculateUniqueCandidatesCount(activeSelections, false);
      const primaryRa = consultantsMap.get(comp.primaryRaId || comp.raConsultantId);

      return {
        company: comp,
        primaryRa,
        allSelections: compSelections,
        activeSelections,
        inProgressCount: activeSelections.length,
        uniquePeople,
        waitingCount,
        remindCount,
        reportCount,
        yomiTotal: Math.round(yomiTotal * 100) / 100
      };
    });

    // 絞り込み処理
    let filtered = companyCards.filter(card => {
      if (card.company.isArchived) return false;
      if (filterOnlyMine && card.company.primaryRaId !== currentCons.consultantId) return false;
      if (filterRaId && card.company.primaryRaId !== filterRaId) return false;

      if (searchCompName) {
        const kw = searchCompName.toLowerCase();
        if (!card.company.name.toLowerCase().includes(kw)) return false;
      }

      if (filterRank && card.company.rank !== filterRank) return false;
      if (filterHasWaiting && card.waitingCount === 0) return false;
      if (filterHasRemind && card.remindCount === 0) return false;

      return true;
    });

    // ソート処理
    filtered.sort((a, b) => {
      if (sortBy === 'rank_desc') {
        const order = { 'SS': 4, 'S': 3, 'A': 2, 'B': 1 };
        const diff = (order[b.company.rank] || 0) - (order[a.company.rank] || 0);
        if (diff !== 0) return diff;
        return a.company.name.localeCompare(b.company.name, 'ja');
      }
      if (sortBy === 'waiting_desc') return b.waitingCount - a.waitingCount;
      if (sortBy === 'remind_desc') return b.remindCount - a.remindCount;
      if (sortBy === 'yomi_desc') return b.yomiTotal - a.yomiTotal;
      if (sortBy === 'count_desc') return b.inProgressCount - a.inProgressCount;
      return (a.company.lastContactDate || '9999').localeCompare(b.company.lastContactDate || '9999');
    });

    // 状態の永続保存
    saveRaState({
      filterRaId,
      filterOnlyMine,
      searchCompName,
      filterRank,
      filterHasWaiting,
      filterHasRemind,
      sortBy,
      openCompanyIds: Array.from(openCompanyIds),
      showEndedSelections,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              RA管理画面
            </h2>
            <p class="text-xs text-slate-500 mt-1">※書類・面接見送りおよび内定辞退案件は企業件数・対話確認対象から除外されています。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-ra-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-indigo-600">
              <span>自分の担当企業のみ表示</span>
            </label>

            <select id="select-ra-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              <option value="">すべてのRA担当</option>
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${filterRaId === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- フィルター & ソート -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex flex-wrap items-center gap-3">
            <input type="text" id="input-ra-search-kw" value="${searchCompName}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

            <select id="select-ra-rank" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-bold text-indigo-900">
              <option value="">すべての企業ランク</option>
              ${COMPANY_RANKS.map(r => `<option value="${r}" ${filterRank === r ? 'selected' : ''}>ランク: ${r}</option>`).join('')}
            </select>

            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="chk-ra-has-waiting" ${filterHasWaiting ? 'checked' : ''} class="rounded text-amber-600">
              <span class="font-semibold text-amber-800">結果待ちあり企業のみ</span>
            </label>

            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="chk-ra-has-remind" ${filterHasRemind ? 'checked' : ''} class="rounded text-rose-600">
              <span class="font-semibold text-rose-800">催促要確認企業のみ</span>
            </label>
          </div>

          <div class="flex items-center space-x-2">
            <span class="text-slate-500 font-semibold">並び替え:</span>
            <select id="select-ra-sort" class="bg-slate-100 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
              <option value="rank_desc" ${sortBy === 'rank_desc' ? 'selected' : ''}>企業ランク順 (SS → S → A → B)</option>
              <option value="waiting_desc" ${sortBy === 'waiting_desc' ? 'selected' : ''}>結果待ち件数が多い順</option>
              <option value="remind_desc" ${sortBy === 'remind_desc' ? 'selected' : ''}>催促要確認が多い順</option>
              <option value="yomi_desc" ${sortBy === 'yomi_desc' ? 'selected' : ''}>企業ヨミが高い順</option>
              <option value="count_desc" ${sortBy === 'count_desc' ? 'selected' : ''}>選考中案件数が多い順</option>
              <option value="lastContact_asc" ${sortBy === 'lastContact_asc' ? 'selected' : ''}>最終連絡日が古い順</option>
            </select>
          </div>
        </div>

        <!-- 担当企業一覧テーブル -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">担当企業一覧 (${filtered.length}社) <span class="text-xs font-normal text-slate-500">（企業行をクリックすると候補者一覧が展開します）</span></h3>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-3 py-3 w-8 text-center">開閉</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-3 py-3">ランク</th>
                  <th class="px-3 py-3">担当RA</th>
                  <th class="px-3 py-3 text-right">選考中/実人数</th>
                  <th class="px-3 py-3 text-right">結果待ち</th>
                  <th class="px-3 py-3 text-right">催促・報告対象</th>
                  <th class="px-3 py-3 text-right">企業ヨミ</th>
                  <th class="px-3 py-3">最終連絡日</th>
                  <th class="px-3 py-3">次回連絡予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${filtered.length === 0 ? `
                  <tr><td colspan="11" class="text-center py-8 text-slate-400">該当する担当企業がありません。</td></tr>
                ` : filtered.map(card => {
                  const comp = card.company;
                  const ra = card.primaryRa;
                  const isOpen = openCompanyIds.has(comp.companyId);
                  const isIncludeEnded = showEndedSelections[comp.companyId] || false;
                  const rankBadge = COMPANY_RANK_BADGES[comp.rank] || COMPANY_RANK_BADGES['B'];

                  const targetSelections = isIncludeEnded ? card.allSelections : card.activeSelections;

                  return `
                    <tr class="company-toggle-row hover:bg-indigo-50/50 transition cursor-pointer select-none ${isOpen ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : ''}" data-company-id="${comp.companyId}">
                      <td class="px-3 py-3 text-center font-bold text-indigo-600">
                        ${isOpen ? '▼' : '▶'}
                      </td>
                      <td class="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
                        <span>${comp.name}</span>
                        ${card.inProgressCount > 0 ? `<span class="text-[10px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded-full font-bold">${card.inProgressCount}</span>` : ''}
                      </td>
                      <td class="px-3 py-3">
                        <span class="px-2 py-0.5 rounded border text-[11px] ${rankBadge.badgeClass}">
                          ${comp.rank}
                        </span>
                      </td>
                      <td class="px-3 py-3 text-slate-700 font-medium">${ra ? ra.name : '未設定'}</td>
                      <td class="px-3 py-3 text-right font-bold text-slate-800">
                        ${card.inProgressCount}件 <span class="text-slate-500 text-[10px]">(${card.uniquePeople}名)</span>
                      </td>
                      <td class="px-3 py-3 text-right">
                        ${card.waitingCount > 0 ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">${card.waitingCount}件</span>` : '<span class="text-slate-400">0</span>'}
                      </td>
                      <td class="px-3 py-3 text-right">
                        ${card.remindCount > 0 ? `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">${card.remindCount}件</span>` : '<span class="text-slate-400">0</span>'}
                      </td>
                      <td class="px-3 py-3 text-right font-black text-indigo-600">${card.yomiTotal}件</td>
                      <td class="px-3 py-3 text-slate-600">${comp.lastContactDate || '-'}</td>
                      <td class="px-3 py-3 font-semibold text-indigo-700">${comp.nextContactDate || '-'}</td>
                      <td class="px-3 py-3 text-center">
                        <button class="btn-create-email stop-propagation px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[11px] transition shadow-sm" data-company-id="${comp.companyId}">
                          メール作成
                        </button>
                      </td>
                    </tr>

                    ${isOpen ? `
                      <tr class="bg-slate-100/70 border-b-2 border-indigo-200">
                        <td colspan="11" class="p-4">
                          <div class="bg-white rounded-xl border border-slate-200 shadow-inner p-4 space-y-3">
                            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 text-xs">
                              <div class="flex items-center space-x-3">
                                <h4 class="font-bold text-slate-800 flex items-center gap-1.5">
                                  <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                  ${comp.name} - 選考候補者一覧 (${targetSelections.length}件)
                                </h4>

                                <label class="inline-flex items-center space-x-1.5 cursor-pointer bg-slate-100 px-2 py-1 rounded border border-slate-200">
                                  <input type="checkbox" class="chk-toggle-ended" data-company-id="${comp.companyId}" ${isIncludeEnded ? 'checked' : ''} class="rounded text-indigo-600">
                                  <span class="font-semibold text-slate-700">過去の終了案件を含めて表示</span>
                                </label>
                              </div>

                              <button class="btn-create-email-selected px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow transition flex items-center gap-1.5" data-company-id="${comp.companyId}">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                選択した候補者でメール作成
                              </button>
                            </div>

                            <div class="overflow-x-auto">
                              <table class="w-full text-left text-xs bg-white rounded-lg border border-slate-200">
                                <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                                  <tr>
                                    <th class="px-3 py-2 w-8 text-center">
                                      <input type="checkbox" class="chk-select-all-candidates" data-company-id="${comp.companyId}">
                                    </th>
                                    <th class="px-3 py-2">候補者名</th>
                                    <th class="px-3 py-2">応募求人・ポジション</th>
                                    <th class="px-2.5 py-2">担当CA</th>
                                    <th class="px-3 py-2">選考フェーズ</th>
                                    <th class="px-3 py-2">進行状態</th>
                                    <th class="px-2.5 py-2">ヨミ</th>
                                    <th class="px-2.5 py-2">次回予定日</th>
                                    <th class="px-3 py-2">企業確認事項</th>
                                    <th class="px-2.5 py-2 text-center">詳細</th>
                                  </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                  ${targetSelections.length === 0 ? `
                                    <tr><td colspan="10" class="text-center py-6 text-slate-400">現在表示できる選考案件はありません。</td></tr>
                                  ` : targetSelections.map(s => {
                                    const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                                    const cand = candidatesMap.get(s.candidateId);
                                    const job = jobsMap.get(s.jobId);
                                    const ca = consultantsMap.get(s.caId || s.caConsultantId);

                                    return `
                                      <tr class="${isEnded ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-indigo-50/30'} transition">
                                        <td class="px-3 py-2 text-center">
                                          <input type="checkbox" class="chk-cand-item" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}">
                                        </td>
                                        <td class="px-3 py-2 font-bold text-slate-900">${cand ? cand.name : s.candidateName}</td>
                                        <td class="px-3 py-2 text-slate-700">${job ? (job.title || job.jobName) : s.jobName}</td>
                                        <td class="px-2.5 py-2 text-slate-600 font-medium">${ca ? ca.name.split(' ')[0] : s.caName || '-'}</td>
                                        
                                        <td class="px-2.5 py-1.5">
                                          <select class="inline-ra-phase border border-slate-300 rounded px-1.5 py-1 text-xs font-semibold text-indigo-700 bg-white" data-selection-id="${s.selectionId}">
                                            ${PHASES.map(p => `<option value="${p}" ${s.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2.5 py-1.5">
                                          <select class="inline-ra-status border border-slate-300 rounded px-1.5 py-1 text-xs font-medium text-slate-800 bg-white" data-selection-id="${s.selectionId}">
                                            ${PROGRESS_STATUSES.map(st => `<option value="${st}" ${s.progressStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2 py-1.5">
                                          <select class="inline-ra-yomi border border-slate-300 rounded px-1.5 py-1 text-xs font-bold bg-white text-indigo-700" data-selection-id="${s.selectionId}">
                                            ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${Number(s.yomi) === y.value ? 'selected' : ''}>${y.label}</option>`).join('')}
                                          </select>
                                        </td>

                                        <td class="px-2.5 py-2 text-slate-600">${s.nextScheduleDate || '-'}</td>
                                        <td class="px-3 py-2 text-slate-700 text-[11px]">${s.companyConfirmationItem || s.companyCheckItems || '-'}</td>
                                        <td class="px-2.5 py-2 text-center">
                                          <button class="btn-ra-cand-detail px-2 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] font-medium transition" data-id="${s.selectionId}">
                                            詳細
                                          </button>
                                        </td>
                                      </tr>
                                    `;
                                  }).join('')}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ` : ''}
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    // イベントバインド
    container.querySelectorAll('.company-toggle-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.stop-propagation')) return;

        const cId = row.getAttribute('data-company-id');
        if (openCompanyIds.has(cId)) {
          openCompanyIds.delete(cId);
        } else {
          openCompanyIds.add(cId);
        }

        saveRaState({
          openCompanyIds: Array.from(openCompanyIds),
          scrollTop: window.scrollY || document.documentElement.scrollTop
        });
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.stop-propagation').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation());
    });

    container.querySelector('#chk-ra-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#select-ra-filter')?.addEventListener('change', (e) => { filterRaId = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#input-ra-search-kw')?.addEventListener('input', (e) => { searchCompName = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-ra-rank')?.addEventListener('change', (e) => { filterRank = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#chk-ra-has-waiting')?.addEventListener('change', (e) => { filterHasWaiting = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#chk-ra-has-remind')?.addEventListener('change', (e) => { filterHasRemind = e.target.checked; updateView(); });
    container.querySelector('#select-ra-sort')?.addEventListener('change', (e) => { sortBy = e.target.value; updateView({ preserveScroll: true }); });

    container.querySelectorAll('.chk-toggle-ended').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const cId = chk.getAttribute('data-company-id');
        showEndedSelections[cId] = chk.checked;
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.chk-select-all-candidates').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const cId = chk.getAttribute('data-company-id');
        const items = container.querySelectorAll(`.chk-cand-item[data-company-id="${cId}"]`);
        items.forEach(item => item.checked = chk.checked);
      });
    });

    container.querySelectorAll('.btn-create-email-selected').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('メール本文に反映する候補者をチェックボックスで選択してください。');
          return;
        }

        onOpenEmailComposer(cId, selIds);
      });
    });

    container.querySelectorAll('.btn-create-email').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-company-id');
        onOpenEmailComposer(cId);
      });
    });

    container.querySelectorAll('.inline-ra-phase').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { phase: e.target.value }, 'RA画面からのフェーズ更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.inline-ra-status').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { progressStatus: e.target.value }, 'RA画面からの状態更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.inline-ra-yomi').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const selId = sel.getAttribute('data-selection-id');
        store.updateSelection(selId, { yomi: Number(e.target.value) }, 'RA画面からのヨミ更新');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-ra-cand-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        saveRaState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenDetail(btn.getAttribute('data-id'));
      });
    });
  }

  updateView({ preserveScroll: true });
}


/**
 * 選考進捗・ヨミ管理システム - 企業対応リスト画面コンポーネント (指示書 3, 12〜27項 - タイトル簡略化 ＆ 3ブロック表示最適化)
 */






const ACTION_LIST_STORAGE_KEY = 'company_action_list_active_state';

function getSavedActionState() {
  try {
    const raw = sessionStorage.getItem(ACTION_LIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveActionState(state) {
  try {
    const current = getSavedActionState();
    sessionStorage.setItem(ACTION_LIST_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

/**
 * 候補者選考案件が「対応対象」かどうかを判定 (指示書 11, 27項)
 */
function isActionNeededSelection(s, today) {
  if (s.phase === '選考終了' || s.phase === '内定辞退') return false;
  if (s.companyActionStatus === '完了' || s.companyActionStatus === '対応完了') return false;

  if (s.progressStatus === '実施済み・結果待ち') return true;
  if (s.companyActionStatus === '未対応' || s.companyActionStatus === '回答待ち' || s.companyActionStatus === '催促中' || s.companyActionStatus === 'CA確認待ち') return true;
  if (s.actionDeadline && new Date(s.actionDeadline) <= today) return true;
  if (s.nextCompanyContactDate && new Date(s.nextCompanyContactDate) <= today) return true;
  if (s.phase === '書類選考' && s.progressStatus === '未対応') return true;
  if (s.phase.includes('面接') && (s.progressStatus === '日程調整中' || s.progressStatus === '未対応')) return true;
  if (s.phase === 'オファー面談・条件提示' || s.phase === '内定') return true;

  return false;
}

function renderCompanyActionListView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedActionState();

  let filterPriority = savedState.filterPriority || '';
  let filterRaId = savedState.filterRaId !== undefined ? savedState.filterRaId : (currentCons.roleType === 'RA' ? currentCons.consultantId : '');
  let filterOnlyMine = savedState.filterOnlyMine !== undefined ? savedState.filterOnlyMine : (currentCons.roleType === 'RA');
  let searchKw = savedState.searchKw || '';
  let sortBy = savedState.sortBy || 'priority_default';
  let openCompanyIds = new Set(savedState.openCompanyIds || []);
  let showModeMap = savedState.showModeMap || {};

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const companies = store.getCompanies();
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();
    const histories = store.getHistories();

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const raConsultants = consultants.filter(c => c.roleType === 'RA' || c.roleType === 'ADMIN');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 企業ごとの優先度判定・最優先代表アクション算出 (指示書 13, 14, 15項)
    const companyActionCards = companies.map(comp => {
      const compSelections = selections.filter(s => !s.isArchived && s.companyId === comp.companyId);
      const activeSelections = compSelections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
      const actionNeededSelections = compSelections.filter(s => isActionNeededSelection(s, today));

      let expiredCount = 0;
      let todayCount = 0;
      let waitingCount = 0;
      let caCheckCount = 0;
      let topActionText = '';

      actionNeededSelections.forEach(s => {
        const u = s.urgencyInfo || {};
        if (u.code === 'expired') expiredCount++;
        else if (u.code === 'today') todayCount++;
        else if (u.code === 'waiting') waitingCount++;
        else if (u.code === 'ca_check') caCheckCount++;

        if (!topActionText) {
          const cand = candidatesMap.get(s.candidateId);
          const cName = cand ? cand.name : (s.candidateName || '');
          topActionText = s.nextAction ? `${cName}様: ${s.nextAction}` : `${cName}様: 選考結果・進捗の確認`;
        }
      });

      // 優先順位スコア計算 (指示書 15項)
      let priorityScore = 0;
      if (expiredCount > 0) priorityScore = 5;
      else if (todayCount > 0) priorityScore = 4;
      else if (actionNeededSelections.length > 0) priorityScore = 3;
      else if (waitingCount > 0) priorityScore = 2;
      else if (caCheckCount > 0) priorityScore = 1;

      const primaryRa = consultantsMap.get(comp.primaryRaId || comp.raConsultantId);
      const uniquePeople = calculateUniqueCandidatesCount(activeSelections, false);

      return {
        company: comp,
        primaryRa,
        allSelections: compSelections,
        activeSelections,
        actionNeededSelections,
        inProgressCount: activeSelections.length,
        actionNeededCount: actionNeededSelections.length,
        expiredCount,
        todayCount,
        waitingCount,
        caCheckCount,
        topActionText: topActionText || '特になし',
        uniquePeople,
        priorityScore
      };
    });

    let filtered = companyActionCards.filter(card => {
      if (card.company.isArchived) return false;
      if (filterOnlyMine && card.company.primaryRaId !== currentCons.consultantId) return false;
      if (filterRaId && card.company.primaryRaId !== filterRaId) return false;

      if (searchKw) {
        const kw = searchKw.toLowerCase();
        if (!card.company.name.toLowerCase().includes(kw)) return false;
      }

      if (filterPriority === 'expired' && card.expiredCount === 0) return false;
      if (filterPriority === 'today' && card.todayCount === 0) return false;

      return true;
    });

    // 指示書 15項のデフォルト並び順：期限超過 ➔ 本日対応 ➔ 要確認 ➔ 企業回答待ち ➔ CA確認 ➔ 企業名
    filtered.sort((a, b) => {
      if (sortBy === 'priority_default') {
        const diff = b.priorityScore - a.priorityScore;
        if (diff !== 0) return diff;
        return a.company.name.localeCompare(b.company.name, 'ja');
      }
      if (sortBy === 'action_count_desc') return b.actionNeededCount - a.actionNeededCount;
      return a.company.name.localeCompare(b.company.name, 'ja');
    });

    saveActionState({
      filterPriority,
      filterRaId,
      filterOnlyMine,
      searchKw,
      sortBy,
      openCompanyIds: Array.from(openCompanyIds),
      showModeMap,
      scrollTop: savedScrollY
    });

    container.innerHTML = `
      <div class="space-y-5">
        <!-- 画面ヘッダー -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
              企業対応
            </h2>
            <p class="text-xs text-slate-500 mt-1">※企業に対する今なすべき次行動・アプローチ管理画面です。</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <label class="inline-flex items-center space-x-1.5 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" id="chk-ra-only-mine" ${filterOnlyMine ? 'checked' : ''} class="rounded text-amber-600">
              <span>自分の担当企業のみ</span>
            </label>

            <select id="select-ra-filter" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              <option value="">すべてのRA担当</option>
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${filterRaId === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- 検索 ＆ フィルター (指示書 15項) -->
        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex flex-wrap items-center gap-3">
            <input type="text" id="input-action-search-kw" value="${searchKw}" placeholder="企業名で検索..." class="bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[200px]">

            <select id="select-action-priority" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-bold text-indigo-900">
              <option value="">すべての絞り込み</option>
              <option value="expired" ${filterPriority === 'expired' ? 'selected' : ''}>🚨 期限超過あり</option>
              <option value="today" ${filterPriority === 'today' ? 'selected' : ''}>⏰ 本日対応あり</option>
            </select>
          </div>

          <div class="flex items-center space-x-2">
            <span class="text-slate-500 font-semibold">並び順:</span>
            <select id="select-action-sort" class="bg-slate-100 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none">
              <option value="priority_default" ${sortBy === 'priority_default' ? 'selected' : ''}>優先度が高い順 (初期表示)</option>
              <option value="action_count_desc" ${sortBy === 'action_count_desc' ? 'selected' : ''}>対応対象件数が多い順</option>
              <option value="name_asc" ${sortBy === 'name_asc' ? 'selected' : ''}>企業名順</option>
            </select>
          </div>
        </div>

        <!-- 企業対応リスト アコーディオンテーブル (指示書 12, 13, 14項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-2">
          <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <h3 class="font-bold text-xs">企業一覧 (${filtered.length}社) <span class="text-[11px] font-normal text-slate-400">（行をクリックすると対応案件を展開します）</span></h3>
          </div>

          <div class="divide-y divide-slate-200 text-xs">
            ${filtered.length === 0 ? `
              <div class="text-center py-8 text-slate-400">該当する対応企業がありません。</div>
            ` : filtered.map(card => {
              const comp = card.company;
              const ra = card.primaryRa;
              const isOpen = openCompanyIds.has(comp.companyId);
              const showMode = showModeMap[comp.companyId] || 'action_needed';

              let displaySelections = card.actionNeededSelections;
              if (showMode === 'in_progress') displaySelections = card.activeSelections;
              if (showMode === 'all') displaySelections = card.allSelections;

              return `
                <!-- 企業ヘッダー行 (指示書 13, 14項) -->
                <div class="action-company-row hover:bg-indigo-50/50 transition cursor-pointer p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 ${isOpen ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : ''}" data-company-id="${comp.companyId}">
                  <!-- 左側: 企業名 ＆ ランク ＆ RA -->
                  <div class="flex items-center space-x-3 min-w-[220px]">
                    <span class="font-bold text-indigo-600 text-xs">${isOpen ? '▼' : '▶'}</span>
                    <div>
                      <div class="font-extrabold text-slate-900 text-xs flex items-center gap-2">
                        <span>${comp.name}</span>
                        ${comp.rank ? `<span class="text-[9px] px-1.5 py-0.2 rounded font-black bg-slate-100 text-slate-800 border border-slate-300">${comp.rank}</span>` : ''}
                      </div>
                      <div class="text-[10px] text-slate-500 font-medium">担当RA: ${ra ? ra.name : '未設定'}</div>
                    </div>
                  </div>

                  <!-- 中央: 対応対象件数 ＆ 内訳バッジ (指示書 13項) -->
                  <div class="flex items-center space-x-2 text-[11px]">
                    <span class="font-extrabold px-2.5 py-1 rounded border ${card.actionNeededCount > 0 ? 'bg-rose-100 text-rose-900 border-rose-300 font-black' : 'bg-slate-100 text-slate-600 border-slate-200'}">
                      対応 ${card.actionNeededCount}件
                    </span>
                    ${card.expiredCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white animate-pulse">期限超過 ${card.expiredCount}件</span>` : ''}
                    ${card.todayCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">本日対応 ${card.todayCount}件</span>` : ''}
                    ${card.waitingCount > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200">回答待ち ${card.waitingCount}件</span>` : ''}
                  </div>

                  <!-- 右側: 最優先の次アクション (代表1件表示) ＆ 操作 (指示書 14, 26項) -->
                  <div class="flex items-center justify-between md:justify-end space-x-3 flex-1">
                    <div class="text-right max-w-xs truncate hidden sm:block">
                      <span class="text-[10px] font-bold text-slate-500 block">最優先アクション</span>
                      <span class="text-[11px] font-bold text-indigo-900 truncate block" title="${card.topActionText}">⚡ ${card.topActionText}</span>
                    </div>

                    <div class="flex items-center space-x-2">
                      <button class="btn-create-email-comp stop-propagation px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-xs shadow-2xs transition" data-company-id="${comp.companyId}">
                        メール作成
                      </button>
                    </div>
                  </div>
                </div>

                <!-- アコーディオン展開エリア: 候補者行 (指示書 16, 17, 18, 19, 20, 21, 23, 24, 25項) -->
                ${isOpen ? `
                  <div class="bg-slate-50 p-3 border-t border-slate-200 space-y-3">
                    <!-- アコーディオン上部コントロール -->
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                      <div class="flex items-center space-x-3 text-xs">
                        <span class="font-bold text-slate-800">表示切替:</span>
                        <div class="flex items-center space-x-1 bg-white p-0.5 rounded border border-slate-300 font-bold text-[11px]">
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'action_needed' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="action_needed" ${showMode === 'action_needed' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            対応対象のみ (${card.actionNeededCount})
                          </label>
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'in_progress' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="in_progress" ${showMode === 'in_progress' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            進行中すべて (${card.inProgressCount})
                          </label>
                          <label class="px-2 py-0.5 rounded cursor-pointer ${showMode === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600'}">
                            <input type="radio" name="show_mode_${comp.companyId}" value="all" ${showMode === 'all' ? 'checked' : ''} class="hidden radio-show-mode" data-company-id="${comp.companyId}">
                            過去含む (${card.allSelections.length})
                          </label>
                        </div>
                      </div>

                      <div class="flex items-center space-x-2">
                        <button class="btn-mark-contacted-selected-action px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded text-xs transition" data-company-id="${comp.companyId}">
                          選択案件を連絡済みにする
                        </button>
                        <button class="btn-create-email-selected-action px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition" data-company-id="${comp.companyId}">
                          選択した案件でメール作成
                        </button>
                      </div>
                    </div>

                    <!-- 候補者行リスト (3ブロック整理: 左:案件 / 中央:対応情報 / 右:操作) (指示書 17項) -->
                    <div class="space-y-2">
                      ${displaySelections.length === 0 ? `
                        <div class="text-center py-4 text-slate-400 bg-white rounded border border-slate-200">対象案件はありません。</div>
                      ` : displaySelections.map(s => {
                        const isEnded = s.phase === '選考終了' || s.phase === '内定辞退';
                        const cand = candidatesMap.get(s.candidateId);
                        const job = jobsMap.get(s.jobId);
                        const ca = consultantsMap.get(s.caId || s.caConsultantId);
                        const isNeeded = isActionNeededSelection(s, today);

                        const nextTarget = s.nextActionTarget || (s.companyActionStatus === 'CA確認待ち' ? 'CA' : '企業');
                        const isTargetCa = nextTarget === 'CA';
                        const targetBadgeClass = isTargetCa ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-indigo-100 text-indigo-900 border-indigo-200';
                        const targetLabel = isTargetCa ? '【CA確認】' : '【企業対応】';

                        const uObj = s.urgencyInfo || {};

                        return `
                          <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-indigo-300 transition ${isEnded ? 'bg-slate-100/80 text-slate-400' : ''}">
                            <!-- チェックボックス & 左ブロック: 案件情報 (指示书 17項) -->
                            <div class="flex items-start space-x-2.5 min-w-[240px]">
                              <input type="checkbox" class="chk-action-cand-item mt-1" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}" ${isNeeded ? 'checked' : ''}>
                              <div>
                                <div class="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                                  <span>${normalizeCandidateName(cand ? cand.name : s.candidateName)} 様</span>
                                  <span class="text-[10px] text-slate-500 font-normal">(CA: ${ca ? ca.name.split(' ')[0] : s.caName || '-'})</span>
                                </div>
                                <div class="text-[10px] text-slate-500 truncate max-w-[200px]" title="${job ? (job.title || job.jobName) : s.jobName}">
                                  ${job ? (job.title || job.jobName) : s.jobName}
                                </div>
                                <div class="text-[10px] font-bold text-indigo-900 mt-0.5">
                                  ${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span>
                                </div>
                              </div>
                            </div>

                            <!-- 中央ブロック: 対応情報 (次の対応・対応先・期限・ステータス) (指示書 17, 18, 19, 20, 21項) -->
                            <div class="flex-1 space-y-1">
                              <div class="flex flex-wrap items-center gap-1.5">
                                <span class="text-[10px] font-bold px-1.5 py-0.2 rounded border ${targetBadgeClass}">${targetLabel}</span>
                                <span class="font-extrabold text-xs text-indigo-950">
                                  ${s.nextAction || '要確認'}
                                </span>
                                ${uObj.badgeClass ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold ${uObj.badgeClass}">${uObj.label}</span>` : ''}
                              </div>

                              <div class="flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
                                ${s.companyConfirmationItem ? `<span class="text-slate-700 truncate max-w-sm" title="${s.companyConfirmationItem}">確認事項: ${s.companyConfirmationItem}</span>` : ''}
                                <span class="font-mono text-slate-500">期限: ${s.actionDeadline || s.nextCompanyContactDate || '未設定'}</span>
                                <span class="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">ステータス: ${s.companyActionStatus || '未対応'}</span>
                              </div>
                            </div>

                            <!-- 右ブロック: ワンクリック操作 (指示書 17項) -->
                            <div class="flex flex-wrap items-center space-x-1 justify-end shrink-0">
                              <button class="btn-action-single-email px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold text-[10px] transition" data-company-id="${comp.companyId}" data-selection-id="${s.selectionId}">
                                メール作成
                              </button>
                              <button data-ra-action="CONTACTED" data-sel-id="${s.selectionId}" class="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold text-[10px] transition">
                                連絡済
                              </button>
                              <button data-ra-action="PASS" data-sel-id="${s.selectionId}" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[10px] transition">
                                通過
                              </button>
                              <button data-ra-action="REJECT" data-sel-id="${s.selectionId}" class="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold text-[10px] transition">
                                見送り
                              </button>
                              <button data-ra-action="DATES_AVAILABLE" data-sel-id="${s.selectionId}" class="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold text-[10px] transition">
                                日程候補あり
                              </button>
                              <button class="btn-action-cand-detail px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold text-[10px] transition" data-id="${s.selectionId}">
                                詳細
                              </button>
                            </div>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }

    container.querySelectorAll('.action-company-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.stop-propagation')) return;

        const cId = row.getAttribute('data-company-id');
        if (openCompanyIds.has(cId)) {
          openCompanyIds.delete(cId);
        } else {
          openCompanyIds.add(cId);
        }

        saveActionState({
          openCompanyIds: Array.from(openCompanyIds),
          scrollTop: window.scrollY || document.documentElement.scrollTop
        });
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.stop-propagation').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation());
    });

    container.querySelector('#chk-action-only-mine')?.addEventListener('change', (e) => { filterOnlyMine = e.target.checked; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-ra-filter')?.addEventListener('change', (e) => { filterRaId = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#input-action-search-kw')?.addEventListener('input', (e) => { searchKw = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-priority')?.addEventListener('change', (e) => { filterPriority = e.target.value; updateView({ preserveScroll: true }); });
    container.querySelector('#select-action-sort')?.addEventListener('change', (e) => { sortBy = e.target.value; updateView({ preserveScroll: true }); });

    container.querySelectorAll('.radio-show-mode').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const cId = radio.getAttribute('data-company-id');
        showModeMap[cId] = radio.value;
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-create-email-selected-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-action-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('メールに含める選考案件にチェックを入れてください。');
          return;
        }

        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, selIds);
      });
    });

    container.querySelectorAll('.btn-create-email-comp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-company-id');
        const card = companyActionCards.find(c => c.company.companyId === cId);
        const selIds = card ? card.actionNeededSelections.map(s => s.selectionId) : [];

        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, selIds.length > 0 ? selIds : null);
      });
    });

    container.querySelectorAll('.btn-action-single-email').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const selId = btn.getAttribute('data-selection-id');
        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenEmailComposer(cId, [selId]);
      });
    });

    container.querySelectorAll('.btn-mark-contacted-selected-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-company-id');
        const checkedItems = container.querySelectorAll(`.chk-action-cand-item[data-company-id="${cId}"]:checked`);
        const selIds = Array.from(checkedItems).map(item => item.getAttribute('data-selection-id'));

        if (selIds.length === 0) {
          alert('連絡済みにする選考案件にチェックを入れてください。');
          return;
        }

        if (confirm(`選択した ${selIds.length} 件の選考案件を連絡済みに更新しますか？`)) {
          selIds.forEach(id => {
            store.updateSelection(id, { companyActionStatus: '完了' }, '企業対応リストからの完了更新');
          });
          alert('選択した選考案件を連絡済みに更新しました。');
          updateView({ preserveScroll: true });
        }
      });
    });

    container.querySelectorAll('.btn-action-single-contacted').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-selection-id');
        store.updateSelection(selId, { companyActionStatus: '完了' }, '個別の企業対応完了');
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('button[data-ra-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-sel-id');
        const act = btn.getAttribute('data-ra-action');
        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        store.handleRaAction(selId, act);
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-action-cand-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        saveActionState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onOpenDetail(btn.getAttribute('data-id'));
      });
    });
  }

  updateView({ preserveScroll: true });
}


/**
 * 選考進捗・ヨミ管理システム - メール作成・連絡登録モーダルコンポーネント (高精度候補者一覧自動反映 ＆ 手動編集保護)
 */





function openEmailComposerModal(companyId, onClose, initialSelectionIds = null) {
  let modalEl = document.getElementById('email-composer-modal');
  if (modalEl) modalEl.remove();

  const company = store.getCompanies().find(c => c.companyId === companyId);
  if (!company) return;

  const selections = store.getSelections().filter(s => !s.isArchived && s.companyId === companyId && s.phase !== '選考終了');
  const candidates = store.getCandidates();
  const jobs = store.getJobs(false, companyId);
  const consultants = store.getConsultants();
  const templates = store.getEmailTemplates();
  const histories = store.getHistories();

  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
  const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
  const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

  let selectedTemplateId = templates[0] ? templates[0].id : '';
  let selectedTone = 'normal';
  
  // 初期選択案件リスト
  let selectedSelectionIds = initialSelectionIds && initialSelectionIds.length > 0 
    ? [...initialSelectionIds]
    : selections.map(s => s.selectionId);

  let generatedSubject = '';
  let generatedBody = '';
  let isManuallyEdited = false; // 手動編集フラグ (指示書 13項)

  modalEl = document.createElement('div');
  modalEl.id = 'email-composer-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  function buildGeneratedBodyAndSubject() {
    const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
    const user = store.getCurrentConsultant();
    const todayStr = new Date().toLocaleDateString('ja-JP');

    // 選択された選考案件の配列 (指示書 8項, 9項)
    const targetSelections = selections.filter(s => selectedSelectionIds.includes(s.selectionId));

    // {{候補者一覧}} 差し込みテキストの自動生成 (指示書 2, 3, 4, 5, 6, 7, 8, 9, 10, 11項)
    const candListResult = buildCandidateListEmailText(targetSelections, candidatesMap, jobsMap, histories);
    const bulkCandidateListStr = candListResult.text;

    // 単体用変数の構築
    let candNameStr = '';
    let jobTitleStr = '';
    let recDateStr = '';
    let interviewDateStr = '';
    let phaseStr = '';
    let statusStr = '';
    let checkItemStr = '';

    if (targetSelections.length === 1) {
      const s = targetSelections[0];
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      candNameStr = normalizeCandidateName(cand ? cand.name : s.candidateName);
      jobTitleStr = job ? job.title : s.jobName;
      recDateStr = s.recommendationDate || '-';
      interviewDateStr = s.nextScheduleDate || '-';
      phaseStr = s.phase;
      statusStr = s.progressStatus;
      checkItemStr = getConfirmationItem(s);
    } else if (targetSelections.length > 1) {
      candNameStr = targetSelections.map(s => normalizeCandidateName(candidatesMap.get(s.candidateId)?.name || s.candidateName)).join('、');
      jobTitleStr = '複数ポジション';
      phaseStr = '各候補者様のステータス';
      checkItemStr = '各候補者様の進捗確認';
    }

    const replaceVars = (text) => {
      if (!text) return '';
      return text
        .replace(/\{\{企業名\}\}/g, company.name)
        .replace(/\{\{企業担当者名\}\}/g, company.contactName || 'ご担当者')
        .replace(/\{\{RA名\}\}/g, user.name)
        .replace(/\{\{候補者名\}\}/g, candNameStr)
        .replace(/\{\{求人名\}\}/g, jobTitleStr)
        .replace(/\{\{推薦日\}\}/g, recDateStr)
        .replace(/\{\{面接実施日\}\}/g, interviewDateStr)
        .replace(/\{\{面接予定日\}\}/g, interviewDateStr)
        .replace(/\{\{選考フェーズ\}\}/g, phaseStr)
        .replace(/\{\{進行状態\}\}/g, statusStr)
        .replace(/\{\{確認事項\}\}/g, checkItemStr)
        .replace(/\{\{候補者回答期限\}\}/g, '近日中')
        .replace(/\{\{本日の日付\}\}/g, todayStr)
        .replace(/\{\{候補者一覧\}\}/g, bulkCandidateListStr);
    };

    generatedSubject = replaceVars(currentTpl?.subjectTemplate || '');
    generatedBody = replaceVars(currentTpl?.bodyTemplate || '');

    return { candListResult, targetSelections };
  }

  function renderModalContent() {
    const { candListResult, targetSelections } = buildGeneratedBodyAndSubject();

    modalEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
        <!-- ヘッダー -->
        <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <h3 class="text-base font-bold flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              企業向け進捗確認メール作成 (${company.name})
            </h3>
            <p class="text-xs text-slate-400 mt-0.5">テンプレート選択・候補者情報自動差し込み・コピー＆連絡履歴更新</p>
          </div>
          <button id="btn-composer-close" class="text-slate-400 hover:text-white p-1">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div class="p-6 overflow-y-auto space-y-5 flex-1">
          <!-- 選択中案件の要約確認エリア (指示書 12項) -->
          <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-slate-800 flex items-center gap-2">
                <span>対象候補者・選考案件の選択</span>
                <span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[11px]">選択中: ${targetSelections.length}案件</span>
              </h4>
              ${candListResult.hasMissingDate ? `
                <span class="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  ⚠️ 一部の選考案件で日付が未登録です（日付行は自動省略されています）
                </span>
              ` : ''}
            </div>

            <!-- 要約バッジ表示 (指示書 12項) -->
            <div class="bg-white p-2.5 rounded-lg border border-slate-200 max-h-28 overflow-y-auto space-y-1">
              ${targetSelections.length === 0 ? `
                <span class="text-slate-400">案件が選択されていません。下記よりチェックを入れて選択してください。</span>
              ` : targetSelections.map(s => {
                const cand = candidatesMap.get(s.candidateId);
                const job = jobsMap.get(s.jobId);
                const dateInfo = getDateInfoForSelection(s, histories);
                return `
                  <div class="text-[11px] text-slate-700 font-medium flex items-center justify-between border-b border-slate-100 pb-1 last:border-0 last:pb-0">
                    <span>・<strong class="text-slate-900">${cand ? cand.name : s.candidateName} 様</strong> ／ ${job ? job.title : s.jobName} ／ <strong class="text-indigo-700">${s.phase} (${s.progressStatus})</strong></span>
                    <span class="text-slate-500 font-mono">${dateInfo ? `${dateInfo.label}:${dateInfo.value}` : '日付未登録'}</span>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="flex flex-wrap gap-2 pt-1">
              ${selections.map(s => {
                const cand = candidatesMap.get(s.candidateId);
                const isSelected = selectedSelectionIds.includes(s.selectionId);
                return `
                  <label class="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded cursor-pointer ${isSelected ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900 font-bold' : 'text-slate-700'}">
                    <input type="checkbox" class="chk-select-item" data-id="${s.selectionId}" ${isSelected ? 'checked' : ''} class="rounded text-indigo-600">
                    <span>${cand ? cand.name : s.candidateName} (${s.phase})</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <!-- テンプレート・トーン選択 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">メールテンプレート</label>
              <select id="select-composer-template" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-3 py-2 focus:outline-none focus:border-indigo-600">
                ${templates.map(t => `<option value="${t.id}" ${t.id === selectedTemplateId ? 'selected' : ''}>${t.templateName}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">文章トーン</label>
              <select id="select-composer-tone" class="w-full bg-white border border-slate-300 font-medium rounded px-3 py-2 focus:outline-none">
                ${EMAIL_TONES.map(tn => `<option value="${tn.value}" ${tn.value === selectedTone ? 'selected' : ''}>${tn.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 件名 & 本文プレビュー/手動編集 (手動編集保護対応) (指示書 13項) -->
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">件名</label>
                <button type="button" id="btn-copy-subject" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">件名をコピー</button>
              </div>
              <input type="text" id="input-composer-subject" value="${generatedSubject}" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 focus:bg-white focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">本文 (手動修正可能)</label>
                <div class="flex items-center space-x-3">
                  <button type="button" id="btn-regenerate-body" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">自動生成文にリセット</button>
                  <button type="button" id="btn-copy-body" class="text-indigo-600 hover:text-indigo-800 font-bold text-[11px]">本文をコピー</button>
                </div>
              </div>
              <textarea id="textarea-composer-body" rows="11" class="w-full bg-slate-50 border border-slate-300 font-mono text-xs rounded p-3 focus:bg-white focus:outline-none leading-relaxed">${generatedBody}</textarea>
            </div>
          </div>

          <!-- 次回予定日設定 -->
          <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span class="font-bold text-slate-700">次回企業連絡予定日 (連絡後に自動設定):</span>
            <input type="date" id="input-composer-next-date" value="${new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0]}" class="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs">
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button type="button" id="btn-copy-both" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            件名と本文をまとめてコピー
          </button>

          <div class="flex items-center space-x-3">
            <button type="button" id="btn-composer-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold">
              閉じる
            </button>
            <button type="button" id="btn-composer-mark-contacted" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow transition">
              コピー＆連絡済みにする
            </button>
          </div>
        </div>
      </div>
    `;

    const bodyTextArea = modalEl.querySelector('#textarea-composer-body');

    // 手動編集イベントの監視 (指示書 13項)
    bodyTextArea?.addEventListener('input', () => {
      isManuallyEdited = true;
    });

    // モーダル閉じる
    modalEl.querySelector('#btn-composer-close')?.addEventListener('click', () => modalEl.remove());
    modalEl.querySelector('#btn-composer-cancel')?.addEventListener('click', () => modalEl.remove());

    // 候補者チェックボックス変更 (手動編集保護付き) (指示書 13項)
    modalEl.querySelectorAll('.chk-select-item').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-id');
        if (isManuallyEdited) {
          if (!confirm('現在編集している本文を再生成しますか？\n手動で編集した内容は上書きされます。')) {
            chk.checked = !chk.checked; // 元に戻す
            return;
          }
        }

        if (chk.checked) {
          if (!selectedSelectionIds.includes(id)) selectedSelectionIds.push(id);
        } else {
          selectedSelectionIds = selectedSelectionIds.filter(i => i !== id);
        }
        isManuallyEdited = false;
        renderModalContent();
      });
    });

    // テンプレート変更 (手動編集保護付き) (指示書 13項)
    modalEl.querySelector('#select-composer-template')?.addEventListener('change', (e) => {
      if (isManuallyEdited) {
        if (!confirm('現在編集している本文を再生成しますか？\n手動で編集した内容は上書きされます。')) {
          e.target.value = selectedTemplateId; // 元に戻す
          return;
        }
      }
      selectedTemplateId = e.target.value;
      isManuallyEdited = false;
      renderModalContent();
    });

    modalEl.querySelector('#select-composer-tone')?.addEventListener('change', (e) => {
      selectedTone = e.target.value;
      renderModalContent();
    });

    // 本文リセットボタン
    modalEl.querySelector('#btn-regenerate-body')?.addEventListener('click', () => {
      if (isManuallyEdited) {
        if (!confirm('手動で編集した内容を破棄し、自動生成文章に戻しますか？')) return;
      }
      isManuallyEdited = false;
      renderModalContent();
    });

    // コピー処理
    modalEl.querySelector('#btn-copy-subject')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      if (await copyToClipboard(subj)) alert('件名をコピーしました');
    });

    modalEl.querySelector('#btn-copy-body')?.addEventListener('click', async () => {
      const body = modalEl.querySelector('#textarea-composer-body').value;
      if (await copyToClipboard(body)) alert('本文をコピーしました');
    });

    modalEl.querySelector('#btn-copy-both')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      const body = modalEl.querySelector('#textarea-composer-body').value;
      const fullText = `件名: ${subj}\n\n${body}`;
      if (await copyToClipboard(fullText)) alert('件名と本文をまとめてコピーしました');
    });

    // コピー＆連絡済みにするアクション
    modalEl.querySelector('#btn-composer-mark-contacted')?.addEventListener('click', async () => {
      const subj = modalEl.querySelector('#input-composer-subject').value;
      const body = modalEl.querySelector('#textarea-composer-body').value;
      const nextDate = modalEl.querySelector('#input-composer-next-date').value;

      const fullText = `件名: ${subj}\n\n${body}`;
      await copyToClipboard(fullText);

      store.addCompanyCommunication({
        companyId,
        selectionIds: selectedSelectionIds,
        communicationType: '進捗確認メール作成',
        method: 'メール',
        templateId: selectedTemplateId,
        subject: subj,
        body: body,
        nextActionDate: nextDate || null,
        status: '連絡済み'
      });

      alert('メール文章をクリップボードにコピーし、連絡履歴を更新しました。');
      modalEl.remove();
      if (onClose) onClose();
    });
  }

  document.body.appendChild(modalEl);
  renderModalContent();
}


/**
 * 選考進捗・ヨミ管理システム - コンサル別画面コンポーネント (四半期(Q)目標管理 & 2025年度4Q連動)
 */





function renderConsultantView(container, initialConsultantId = '', { onOpenDetail }) {
  const consultants = store.getConsultants();
  let activeConsultantId = initialConsultantId || store.getCurrentConsultant().consultantId;
  let activeRoleType = 'CA'; // 'CA' | 'RA'

  // ブラウザの当日日付から正しい年度・Qを自動初期判定 (指示書 1, 3, 4, 5項)
  const currentInitialFQ = getFiscalQuarterFromDate(new Date());
  let selectedFiscalYear = currentInitialFQ.fiscalYear;
  let selectedQuarter = currentInitialFQ.quarter;

  function updateView() {
    const activeCons = consultants.find(c => c.consultantId === activeConsultantId) || consultants[0] || {};
    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Q目標データの取得 (指示書 19項)
    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const targetObj = qTargets.find(t => t.consultantId === activeCons.consultantId);
    
    // RA担当時は目標対象外、CA担当時は個人目標をセット
    const isRaView = activeRoleType === 'RA';
    const myQTarget = isRaView 
      ? null 
      : (targetObj ? Number(targetObj.targetCount || 0) : (activeCons.roleType === 'ADMIN' ? 5 : (activeCons.roleType === 'CA' ? 4 : 3)));

    // CA / RA による担当案件抽出 (ID最優先照合 ＆ 旧データ補完: 指示書 15項)
    const myAllSelections = selections.filter(s => {
      if (s.isArchived) return false;
      const targetConsId = activeCons.consultantId;
      const targetName = activeCons.name;

      if (activeRoleType === 'CA') {
        if (s.caId || s.caConsultantId) {
          return s.caId === targetConsId || s.caConsultantId === targetConsId;
        }
        return s.caName === targetName;
      } else {
        if (s.raId || s.raConsultantId) {
          return s.raId === targetConsId || s.raConsultantId === targetConsId;
        }
        return s.raName === targetName;
      }
    });

    // 1. Q承諾実績 (対象Q内に内定承諾日・入社日がある案件: 指示書 17項)
    const myAcceptedSelections = myAllSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const myAcceptedCount = myAcceptedSelections.length;

    // 2. Q進行中ヨミ (完了見込み月・判定優先度で対象Qに含まれる進行中案件: 指示書 8, 14, 15, 16項)
    const myInProgSelectionsInQ = myAllSelections.filter(s => {
      // 進行中以外・除外対象（内定承諾・辞退・終了等）を除外 (指示書 16項)
      if (['選考終了', '内定辞退', '内定承諾', '入社予定', '書類見送り', '面接見送り', '候補者辞退', '他社決定'].includes(s.phase)) {
        return false;
      }
      return isSelectionInQuarter(s, selectedFiscalYear, selectedQuarter);
    });

    // ヨミの正規化合計計算 (指示書 9, 10項)
    const rawYomiSum = myInProgSelectionsInQ.reduce((sum, s) => sum + normalizeYomi(s.yomi), 0);
    const myInProgYomi = Math.round(rawYomiSum * 100) / 100;

    // 3. Q着地見込み, 4. 不足, 5. 達成率 (指示書 11, 12, 13項)
    const myForecast = Math.round((myAcceptedCount + myInProgYomi) * 100) / 100;
    
    let myShortage = 0;
    let myRate = 0;

    if (!isRaView && myQTarget !== null) {
      myShortage = Math.max(0, Math.round((myQTarget - myForecast) * 100) / 100);
      myRate = myQTarget > 0 ? Math.round((myForecast / myQTarget) * 1000) / 10 : 0;
    }

    // フェーズ別件数集計 (完璧な一致保証: 指示書 23項)
    const phaseCounts = PHASES.map(p => ({
      phase: p,
      count: myInProgSelectionsInQ.filter(s => s.phase === p).length
    }));

    // 役割ラベル表示の成形 (undefined 防護: 指示書 20項)
    const roleDisplay = activeCons.roles && Array.isArray(activeCons.roles) && activeCons.roles.length > 0
      ? activeCons.roles.join('・')
      : (activeCons.roleType || 'CA');

    // 動的年度選択肢の計算 (現在年の前後)
    const baseFY = currentInitialFQ.fiscalYear;
    const fyOptions = [baseFY - 1, baseFY, baseFY + 1, baseFY + 2];

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & コンサル切り替え -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 bg-indigo-600 text-white rounded-full font-black text-lg flex items-center justify-center shadow shrink-0">
              ${(activeCons.name || '相').charAt(0)}
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <h2 class="text-lg font-bold text-slate-800">${activeCons.name || '担当者未選択'} の選考進捗・実績管理</h2>
                <span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-extrabold rounded-lg text-xs border border-indigo-200">集計対象: ${activeCons.name || ''}／${activeRoleType}担当</span>
              </div>
              <p class="text-xs text-slate-500 font-medium mt-0.5">
                <span class="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold rounded border border-slate-200 mr-2">${roleDisplay}</span>
                ${activeCons.email || ''}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2.5 text-xs">
            <!-- 年度 ＆ Q選択ドロップダウン (指示書 4, 6, 7項) -->
            <select id="select-cons-fy" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${fyOptions.map(fy => `<option value="${fy}" ${selectedFiscalYear === fy ? 'selected' : ''}>${fy}年度</option>`).join('')}
            </select>

            <select id="select-cons-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900 focus:outline-none focus:border-indigo-600">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

            <!-- CA / RA 切替 -->
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-role-ca" class="px-3 py-1 rounded transition ${activeRoleType === 'CA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
                CA担当
              </button>
              <button id="btn-role-ra" class="px-3 py-1 rounded transition ${activeRoleType === 'RA' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
                RA担当
              </button>
            </div>

            <!-- コンサルタント選択 (undefined完全修正: 指示書 20項) -->
            <select id="select-consultant-change" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${consultants.map(c => {
                const cRoleLabel = c.roles && Array.isArray(c.roles) && c.roles.length > 0 ? c.roles.join('・') : (c.roleType || 'CA');
                return `<option value="${c.consultantId}" ${c.consultantId === activeCons.consultantId ? 'selected' : ''}>${c.name} (${cRoleLabel})</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <!-- Q KPIカード (指示書 10, 11, 12, 13, 19項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-xs">
            <div class="text-xs text-slate-400 font-semibold">個人Q目標</div>
            <div class="text-2xl font-black mt-1">
              ${isRaView ? '<span class="text-sm text-slate-400 font-bold">対象外</span>' : `${myQTarget}<span class="text-xs font-normal text-slate-400 ml-1">件</span>`}
            </div>
          </div>

          <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-emerald-800">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${myAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
          </div>

          <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-indigo-800">Q進行中ヨミ合計</div>
            <div class="text-2xl font-black text-indigo-600 mt-1">${myInProgYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
          </div>

          <div class="bg-purple-50 border border-purple-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-purple-800">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600 mt-1">${myForecast}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
          </div>

          <div class="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-rose-800">Q不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600 mt-1">
              ${isRaView ? '<span class="text-sm text-rose-400 font-bold">-</span>' : `${myShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span>`}
            </div>
          </div>

          <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-xs">
            <div class="text-xs font-bold text-amber-800">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">
              ${isRaView ? '<span class="text-sm text-amber-400 font-bold">-</span>' : `${myRate}%`}
            </div>
          </div>
        </div>

        <!-- フェーズ別件数プログレス (一致性保証: 指示書 7, 23項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 class="font-bold text-slate-800 text-xs flex items-center justify-between">
            <span>対象Q フェーズ別案件内訳 (${qRange.label})</span>
            <span class="text-[11px] text-slate-500 font-normal">※進行中案件 ${myInProgSelectionsInQ.length} 件</span>
          </h3>
          <div class="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2 text-center text-xs">
            ${phaseCounts.map(item => `
              <div class="bg-slate-50 border border-slate-200 p-2 rounded-lg hover:border-indigo-300 transition">
                <div class="text-[10px] text-slate-500 font-semibold line-clamp-1" title="${item.phase}">${item.phase}</div>
                <div class="text-base font-black ${item.count > 0 ? 'text-indigo-600' : 'text-slate-400'} mt-1">${item.count}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 担当案件一覧テーブル (ヨミ正規化表示 & 完全一致保証: 指示書 21, 22, 23項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">
              対象Q 担当案件一覧 (${myInProgSelectionsInQ.length}件)
            </h3>
            <span class="text-xs text-slate-500 font-semibold">ヨミ合計: <strong class="text-indigo-600 text-sm font-black">${myInProgYomi}</strong> 件</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3">進行状態</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${myInProgSelectionsInQ.length === 0 ? `
                  <tr><td colspan="8" class="text-center py-8 text-slate-400 font-bold">対象Qに着地見込みの選考案件がありません。</td></tr>
                ` : myInProgSelectionsInQ.map(s => {
                  const cand = candidatesMap.get(s.candidateId);
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const normalizedYomiVal = normalizeYomi(s.yomi);
                  const percentStr = Math.round(normalizedYomiVal * 100) + '%';

                  return `
                    <tr class="hover:bg-indigo-50/40 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">${cand ? cand.name : s.candidateName}</td>
                      <td class="px-4 py-2.5 font-medium text-slate-800">${comp ? comp.name : s.companyName}</td>
                      <td class="px-4 py-2.5 text-slate-600">${job ? (job.title || job.jobName) : s.jobName}</td>
                      <td class="px-3 py-2.5 font-semibold text-indigo-700">${s.phase}</td>
                      <td class="px-3 py-2.5 text-slate-700">${s.progressStatus}</td>
                      <td class="px-3 py-2.5 text-right font-black ${normalizedYomiVal > 0 ? 'text-indigo-600' : 'text-slate-400'}">${percentStr}</td>
                      <td class="px-3 py-2.5 font-mono text-slate-700 font-bold">${s.expectedCompletionMonth || s.actionDeadline || '-'}</td>
                      <td class="px-3 py-2.5 text-center">
                        <button class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-xs transition" data-id="${s.selectionId}">詳細</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // イベントリスナー設定（手動切り替え時に自動で当日Qに戻さない構造: 指示書 6, 25項）
    container.querySelector('#select-cons-fy')?.addEventListener('change', (e) => {
      selectedFiscalYear = parseInt(e.target.value, 10);
      updateView();
    });

    container.querySelector('#select-cons-q')?.addEventListener('change', (e) => {
      selectedQuarter = e.target.value;
      updateView();
    });

    container.querySelector('#btn-role-ca')?.addEventListener('click', () => {
      activeRoleType = 'CA';
      updateView();
    });

    container.querySelector('#btn-role-ra')?.addEventListener('click', () => {
      activeRoleType = 'RA';
      updateView();
    });

    container.querySelector('#select-consultant-change')?.addEventListener('change', (e) => {
      activeConsultantId = e.target.value;
      updateView();
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}


/**
 * 選考進捗・ヨミ管理システム - 企業別・提出エクスポート画面コンポーネント (3Step提出資料作成・社内情報完全除外・プレビュー・履歴管理対応)
 */






const COMPANY_VIEW_STORAGE_KEY = 'company_view_active_state';

function getSavedCompanyViewState() {
  try {
    const raw = sessionStorage.getItem(COMPANY_VIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveCompanyViewState(state) {
  try {
    const current = getSavedCompanyViewState();
    sessionStorage.setItem(COMPANY_VIEW_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderCompanyView(container, initialCompanyId = '', { onOpenDetail }) {
  const savedState = getSavedCompanyViewState();

  const companies = store.getCompanies();
  let selectedCompanyId = initialCompanyId || savedState.selectedCompanyId || (companies[0] ? companies[0].companyId : '');
  let submissionPurpose = savedState.submissionPurpose || '面接結果の確認'; // 提出用途 (指示書 9項)
  let filterMode = savedState.filterMode || 'action_required'; // 対応対象のみ | 選考中すべて | 結果待ちのみ | 日程調整中のみ | 内定・条件提示のみ | 前回提出後に更新あり | 新規推薦のみ | 終了案件を含む (指示書 6項)
  let groupMode = savedState.groupMode || 'job'; // 求人別 | 選考フェーズ別 | 候補者名順 | 対応優先度順 | 推薦日順 | 面接日順 (指示書 20項)
  let saveChangesToSelections = savedState.saveChangesToSelections || false; // 今回の出力だけに反映する[既定] or 選考案件データにも保存する (指示書 12項)

  // 手動選択チェックボックス状態
  let selectedSelectionIds = new Set(savedState.selectedSelectionIds || []);

  // プレビュー用カスタム編集データ (selectionId -> { customName, customJob, customStatus, customDate, customCheckItem, customSharedComment })
  let customPreviewEdits = savedState.customPreviewEdits || {};

  function updateView() {
    const currentCompany = companies.find(c => c.companyId === selectedCompanyId) || companies[0];
    if (!currentCompany) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400">企業データが登録されていません。</div>';
      return;
    }
    selectedCompanyId = currentCompany.companyId;

    const selections = store.getSelections();
    const jobs = store.getJobs(true, selectedCompanyId);
    const candidates = store.getCandidates();
    const consultants = store.getConsultants();
    const histories = store.getCompanyCommunications(selectedCompanyId);
    const submissions = store.getCompanySubmissions(selectedCompanyId);
    const lastSubmission = store.getLastCompanySubmission(selectedCompanyId);
    const lastSubmissionDate = lastSubmission ? new Date(lastSubmission.submittedAt) : null;

    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const raCons = consultantsMap.get(currentCompany.primaryRaId || currentCompany.raConsultantId);

    // 選択企業に紐づく選考案件を抽出 (指示書 4, 5項)
    const companySelections = selections.filter(s => s.companyId === selectedCompanyId && !s.isArchived);

    // 自動選択の初期化ロジック (対応対象案件を自動チェック) (指示書 7項)
    if (!savedState.selectedCompanyId || savedState.selectedCompanyId !== selectedCompanyId) {
      selectedSelectionIds.clear();
      companySelections.forEach(s => {
        if (s.phase === '選考終了') return;
        const isActionNeeded = s.progressStatus === '実施済み・結果待ち' 
          || s.progressStatus === '未対応' 
          || s.progressStatus === '回答待ち'
          || s.progressStatus === '調整中'
          || s.companyConfirmationItem
          || (s.nextScheduleDate && new Date(s.nextScheduleDate) < new Date());
        
        if (isActionNeeded) {
          selectedSelectionIds.add(s.selectionId);
        }
      });
    }

    // 表示切り替えフィルターの適用 (指示書 6, 21, 22項)
    const filteredSelections = companySelections.filter(s => {
      const isUpdatedAfterLastSub = lastSubmissionDate && new Date(s.updatedAt) > lastSubmissionDate;

      if (filterMode === 'action_required') {
        if (s.phase === '選考終了') return false;
        return s.progressStatus === '実施済み・結果待ち' || s.progressStatus === '未対応' || s.progressStatus === '回答待ち' || s.progressStatus === '調整中' || s.companyConfirmationItem;
      }
      if (filterMode === 'all_in_progress') return s.phase !== '選考終了';
      if (filterMode === 'waiting_result') return s.progressStatus === '実施済み・結果待ち';
      if (filterMode === 'adjusting') return s.progressStatus === '調整中' || s.progressStatus === '日程確定';
      if (filterMode === 'offer') return s.phase === '内定' || s.phase === 'オファー面談・条件提示' || s.phase === '内定承諾' || s.phase === '入社予定';
      if (filterMode === 'updated_after_last') return isUpdatedAfterLastSub;
      if (filterMode === 'new_recommendation') return s.phase === '書類選考' && s.progressStatus === '未対応';
      if (filterMode === 'include_ended') return true;
      return true;
    });

    // グループ分け処理 (指示書 20項)
    let groupedSelectionsMap = new Map();
    if (groupMode === 'job') {
      filteredSelections.forEach(s => {
        const jTitle = s.jobName || (jobsMap.get(s.jobId)?.title) || '求人未指定';
        const list = groupedSelectionsMap.get(jTitle) || [];
        list.push(s);
        groupedSelectionsMap.set(jTitle, list);
      });
    } else if (groupMode === 'phase') {
      filteredSelections.forEach(s => {
        const p = s.phase || 'その他';
        const list = groupedSelectionsMap.get(p) || [];
        list.push(s);
        groupedSelectionsMap.set(p, list);
      });
    } else {
      groupedSelectionsMap.set('対象選考案件一覧', filteredSelections);
    }

    // 選択中案件リスト
    const targetSelections = companySelections.filter(s => selectedSelectionIds.has(s.selectionId));

    // 出力前チェック警告の判定 (指示書 14項)
    const missingWarnings = [];
    if (!currentCompany.contactName && !currentCompany.contactPerson) missingWarnings.push('企業人事担当者名が未登録です。');
    if (!currentCompany.contactEmail) missingWarnings.push('企業人事担当者メールアドレスが未登録です。');
    
    let missingCheckItemCount = 0;
    let missingDateCount = 0;
    targetSelections.forEach(s => {
      if (!s.companyConfirmationItem) missingCheckItemCount++;
      if (!s.recommendationDate && !s.nextScheduleDate) missingDateCount++;
    });
    if (missingCheckItemCount > 0) missingWarnings.push(`${missingCheckItemCount}件の案件で確認事項が未入力です。`);
    if (missingDateCount > 0) missingWarnings.push(`${missingDateCount}件の案件で日付が未登録です。`);

    // 状態の保存 (指示書 30項)
    saveCompanyViewState({
      selectedCompanyId,
      submissionPurpose,
      filterMode,
      groupMode,
      saveChangesToSelections,
      selectedSelectionIds: Array.from(selectedSelectionIds),
      customPreviewEdits,
      scrollTop: window.scrollY || document.documentElement.scrollTop
    });

    const rankBadge = COMPANY_RANK_BADGES[currentCompany.rank] || COMPANY_RANK_BADGES['B'];

    container.innerHTML = `
      <div class="space-y-6 text-xs">
        <!-- Step 1: 企業選択 & 提出条件ヘッダー (指示書 3, 4, 9, 20項) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <div class="flex items-center space-x-3">
                <h2 class="text-xl font-bold text-slate-800">企業別・提出エクスポート資料作成</h2>
                <span class="px-2.5 py-0.5 rounded text-xs font-extrabold border ${rankBadge.badgeClass}">${rankBadge.label}</span>
              </div>
              <p class="text-xs text-slate-500 mt-1">選考案件の抽出・企業向け確認資料のプレビュー生成・Excel/CSV/メール一括出力</p>
            </div>

            <!-- 企業選択ドロップダウン (指示書 4項) -->
            <div class="flex items-center space-x-2">
              <span class="font-bold text-slate-700">対象企業:</span>
              <select id="select-export-company" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-indigo-900 text-sm focus:outline-none focus:border-indigo-600">
                ${companies.map(c => `<option value="${c.companyId}" ${c.companyId === selectedCompanyId ? 'selected' : ''}>${c.name} (${c.rank})</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 企業基本情報カード (指示書 4, 21, 24項) -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div>
              <div class="text-[10px] text-slate-400 font-bold">主担当RA</div>
              <div class="font-bold text-slate-800">${raCons ? raCons.name : '未設定'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">人事担当者</div>
              <div class="font-bold text-slate-800">${currentCompany.contactPerson || currentCompany.contactName || '未登録'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">人事メールアドレス</div>
              <div class="font-mono font-bold text-indigo-700">${currentCompany.contactEmail || '未登録'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">前回提出日時</div>
              <div class="font-mono font-bold text-slate-800">${lastSubmissionDate ? lastSubmissionDate.toLocaleString('ja-JP') : 'なし'}</div>
            </div>
          </div>

          <!-- 提出用途 & 表示切り替えコントロール (指示書 6, 9, 20項) -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            <div>
              <label class="block font-bold text-slate-700 mb-1">今回の提出用途 (指示書 9項)</label>
              <select id="select-submission-purpose" class="w-full bg-indigo-50 border border-indigo-200 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                ${['書類選考結果の確認', '面接結果の確認', '面接日程の確認', '選考進捗の一括確認', '候補者状況の報告', '最終面接結果の確認', '内定条件の確認', '定例進捗報告', 'その他'].map(p => `<option value="${p}" ${submissionPurpose === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">絞り込み表示 (指示書 6項)</label>
              <select id="select-filter-mode" class="w-full bg-slate-50 border border-slate-300 font-semibold text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="action_required" ${filterMode === 'action_required' ? 'selected' : ''}>対応対象のみ (推奨・初期表示)</option>
                <option value="all_in_progress" ${filterMode === 'all_in_progress' ? 'selected' : ''}>選考中すべて</option>
                <option value="waiting_result" ${filterMode === 'waiting_result' ? 'selected' : ''}>結果待ちのみ</option>
                <option value="adjusting" ${filterMode === 'adjusting' ? 'selected' : ''}>日程調整中のみ</option>
                <option value="offer" ${filterMode === 'offer' ? 'selected' : ''}>内定・条件提示のみ</option>
                <option value="updated_after_last" ${filterMode === 'updated_after_last' ? 'selected' : ''}>前回提出後に更新あり</option>
                <option value="new_recommendation" ${filterMode === 'new_recommendation' ? 'selected' : ''}>新規推薦のみ</option>
                <option value="include_ended" ${filterMode === 'include_ended' ? 'selected' : ''}>選考終了案件を含む全件</option>
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">グループ並び順 (指示書 20項)</label>
              <select id="select-group-mode" class="w-full bg-slate-50 border border-slate-300 font-semibold text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="job" ${groupMode === 'job' ? 'selected' : ''}>求人・ポジション別</option>
                <option value="phase" ${groupMode === 'phase' ? 'selected' : ''}>選考フェーズ別</option>
                <option value="flat" ${groupMode === 'flat' ? 'selected' : ''}>一括フラット表示</option>
              </select>
            </div>
          </div>
        </div>

        <!-- メイン2カラムコンテンツ: 左[候補者選択テーブル] & 右[企業向け資料プレビュー] (指示書 5, 8, 10, 11, 15項) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- 左側: 提出対象候補者選択テーブル (7カラム) (指示書 5, 8, 22項) -->
          <div class="lg:col-span-7 space-y-4">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
              <div class="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 class="font-bold text-slate-800 text-sm">
                    1. 提出対象案件の選択 (${targetSelections.length} / ${companySelections.length} 件選択中)
                  </h3>
                  <p class="text-[10px] text-slate-500 mt-0.5">一括ボタンまたは個別のチェックで提出資料へ含める案件を選択します</p>
                </div>

                <!-- 一括選択ボタン (指示書 8項) -->
                <div class="flex items-center space-x-1 font-bold">
                  <button id="btn-select-all" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px]">全選択</button>
                  <button id="btn-deselect-all" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px]">全解除</button>
                  <button id="btn-select-actions" class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px]">対応対象選択</button>
                </div>
              </div>

              <!-- 候補者一覧テーブル (指示書 5, 22項) -->
              <div class="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-900 text-slate-200 font-semibold sticky top-0 border-b border-slate-800 z-10">
                    <tr>
                      <th class="px-3 py-2.5 text-center w-10">選択</th>
                      <th class="px-3 py-2.5">候補者名 / 求人</th>
                      <th class="px-3 py-2.5">選考状況 / フェーズ</th>
                      <th class="px-3 py-2.5">確認事項 / 共有コメント</th>
                      <th class="px-3 py-2.5 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200">
                    ${Array.from(groupedSelectionsMap.entries()).map(([groupTitle, selectionsInGroup]) => `
                      <tr class="bg-slate-100/80 font-bold text-slate-800">
                        <td colspan="5" class="px-3 py-1.5 text-[11px] border-y border-slate-200">
                          📁 ${groupTitle} (${selectionsInGroup.length}件)
                        </td>
                      </tr>
                      ${selectionsInGroup.map(s => {
                        const cand = candidatesMap.get(s.candidateId);
                        const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                        const isChecked = selectedSelectionIds.has(s.selectionId);
                        const isUpdatedAfterLast = lastSubmissionDate && new Date(s.updatedAt) > lastSubmissionDate;

                        return `
                          <tr class="hover:bg-indigo-50/40 transition ${isChecked ? 'bg-indigo-50/20' : ''}">
                            <td class="px-3 py-3 text-center">
                              <input type="checkbox" class="chk-select-item cursor-pointer text-indigo-600 rounded" data-id="${s.selectionId}" ${isChecked ? 'checked' : ''}>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-slate-900 flex items-center gap-1.5">
                                <span>${cand ? cand.name : s.candidateName} 様</span>
                                ${isUpdatedAfterLast ? '<span class="px-1.5 py-0.2 bg-amber-100 text-amber-800 font-bold rounded text-[9px]">更新あり</span>' : ''}
                              </div>
                              <div class="text-[10px] text-slate-500 line-clamp-1">${s.jobName || '求人未指定'}</div>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-indigo-700">${s.phase}</div>
                              <div class="text-[10px] text-slate-600">${s.progressStatus}</div>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-amber-800 line-clamp-1">${s.companyConfirmationItem || '確認事項なし'}</div>
                              <div class="text-[10px] text-slate-500 line-clamp-1">${s.companySharedComment || '-'}</div>
                            </td>
                            <td class="px-3 py-3 text-center">
                              <button class="btn-detail px-2 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[10px] font-bold" data-id="${s.selectionId}">詳細</button>
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 右側: 企業向け資料リアルタイムプレビュー ＆ 出力アクション (5カラム) (指示書 10, 11, 12, 14, 15, 16, 17, 18項) -->
          <div class="lg:col-span-5 space-y-4">
            
            <!-- 出力前チェック不整合警告 (指示書 14項) -->
            ${missingWarnings.length > 0 ? `
              <div class="bg-amber-50 border-l-4 border-amber-500 p-3.5 rounded-r-xl shadow-sm space-y-1 text-xs">
                <div class="font-bold text-amber-900 flex items-center gap-1.5">
                  <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  <span>出力前の確認事項・注意</span>
                </div>
                <ul class="list-disc list-inside text-[11px] text-amber-800 space-y-0.5">
                  ${missingWarnings.map(w => `<li>${w}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            <!-- 企業向けプレビューカード (社内情報完全除外) (指示書 10, 11, 15項) -->
            <div class="bg-white rounded-xl border border-indigo-200 shadow-md overflow-hidden space-y-4 p-5">
              <div class="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 class="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                  2. 企業向け提出資料 プレビュー
                </h3>
                <span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-extrabold border border-emerald-200">
                  🔒 社内情報除外済み
                </span>
              </div>

              <!-- プレビュー上の反映設定 (指示書 12項) -->
              <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-[11px]">
                <span class="font-bold text-slate-700">プレビュー編集の反映範囲:</span>
                <label class="flex items-center space-x-1 font-bold text-indigo-800 cursor-pointer">
                  <input type="checkbox" id="chk-save-to-selections" ${saveChangesToSelections ? 'checked' : ''} class="text-indigo-600">
                  <span>選考案件データにも保存する</span>
                </label>
              </div>

              <!-- プレビュー本文エリア (指示書 10, 11, 13項) -->
              <div id="preview-document-area" class="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-4 max-h-[420px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                <!-- 資料ヘッダー -->
                <div class="border-b border-slate-300 pb-2 space-y-1">
                  <div class="font-bold text-sm text-slate-900">${currentCompany.name} 御中</div>
                  <div class="font-extrabold text-indigo-900">${submissionPurpose} 一覧</div>
                  <div class="text-[10px] text-slate-500 flex justify-between pt-1">
                    <span>作成日: ${new Date().toLocaleDateString('ja-JP')}</span>
                    <span>担当: サンクスパートナーズ (${raCons ? raCons.name : '担当RA'})</span>
                  </div>
                </div>

                <!-- 候補者一覧プレビュー -->
                <div class="space-y-3">
                  ${targetSelections.length === 0 ? `
                    <div class="text-center py-8 text-slate-400">提出対象としてチェックされた候補者がありません。</div>
                  ` : targetSelections.map((s, idx) => {
                    const cand = candidatesMap.get(s.candidateId);
                    const dateStr = s.nextScheduleDate || s.recommendationDate || s.phaseUpdatedAt || '-';
                    const customEdit = customPreviewEdits[s.selectionId] || {};

                    return `
                      <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1.5 relative group">
                        <div class="font-bold text-slate-900 text-xs flex items-center justify-between">
                          <span>${idx + 1}. ${customEdit.name || (cand ? cand.name : s.candidateName)} 様</span>
                          <span class="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded font-sans font-bold">${s.phase} (${s.progressStatus})</span>
                        </div>
                        <div class="text-slate-600 text-[10px]">応募ポジション: ${s.jobName || '求人未指定'}</div>
                        <div class="text-slate-600 text-[10px]">選考日/推薦日: ${dateStr}</div>
                        <div class="text-amber-900 font-bold text-[11px] bg-amber-50 p-1.5 rounded border border-amber-100">
                          📌 確認事項: ${customEdit.checkItem || s.companyConfirmationItem || '合否確認'}
                        </div>
                        ${s.companySharedComment ? `
                          <div class="text-slate-600 text-[10px]">💬 共有メモ: ${customEdit.sharedComment || s.companySharedComment}</div>
                        ` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Step 3: 出力 ＆ アクションボタン群 (指示書 16, 17, 18, 19, 25項) -->
              <div class="space-y-2 border-t border-slate-200 pt-4">
                <div class="font-bold text-slate-800 text-xs mb-1">3. 出力 ＆ 提出実行</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <!-- Excel出力 -->
                  <button id="btn-export-excel" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h55.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <span>Excel出力</span>
                  </button>

                  <!-- CSV出力 -->
                  <button id="btn-export-csv" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span>CSV出力</span>
                  </button>

                  <!-- メール作成 -->
                  <button id="btn-export-email" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    <span>メール本文作成</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 提出履歴表示パネル (指示书 25, 26項) -->
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
              <h3 class="font-bold text-slate-800 text-xs flex items-center justify-between border-b border-slate-200 pb-2">
                <span>過去の企業提出履歴 (${submissions.length}件)</span>
                <span class="text-[10px] text-slate-400 font-normal">提出記録 ＆ 回答状況</span>
              </h3>

              <div class="max-h-48 overflow-y-auto space-y-2">
                ${submissions.length === 0 ? `
                  <div class="text-slate-400 text-center py-4 text-[11px]">この企業への過去の提出履歴はありません。</div>
                ` : submissions.map(sub => `
                  <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-[11px]">
                    <div class="flex items-center justify-between font-bold">
                      <span class="text-indigo-900">${new Date(sub.submittedAt).toLocaleString('ja-JP')}</span>
                      <span class="px-1.5 py-0.2 rounded text-[9px] ${sub.responseStatus === '回答済み' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${sub.responseStatus || '未回答'}</span>
                    </div>
                    <div class="text-slate-700">用途: ${sub.submissionPurpose} (${sub.targetCount}件 / ${sub.outputType})</div>
                    <div class="text-slate-500 text-[10px]">担当: ${sub.submittedByName}</div>
                  </div>
                `).join('')}
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    // -------------------------------------------------------------
    // イベントバインド
    // -------------------------------------------------------------

    container.querySelector('#select-export-company')?.addEventListener('change', (e) => {
      selectedCompanyId = e.target.value;
      saveCompanyViewState({ selectedCompanyId });
      updateView();
    });

    container.querySelector('#select-submission-purpose')?.addEventListener('change', (e) => {
      submissionPurpose = e.target.value;
      updateView();
    });

    container.querySelector('#select-filter-mode')?.addEventListener('change', (e) => {
      filterMode = e.target.value;
      updateView();
    });

    container.querySelector('#select-group-mode')?.addEventListener('change', (e) => {
      groupMode = e.target.value;
      updateView();
    });

    container.querySelector('#chk-save-to-selections')?.addEventListener('change', (e) => {
      saveChangesToSelections = e.target.checked;
    });

    // 個別チェック
    container.querySelectorAll('.chk-select-item').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = chk.getAttribute('data-id');
        if (e.target.checked) {
          selectedSelectionIds.add(id);
        } else {
          selectedSelectionIds.delete(id);
        }
        updateView();
      });
    });

    // 一括操作ボタン (指示書 8項)
    container.querySelector('#btn-select-all')?.addEventListener('click', () => {
      companySelections.forEach(s => selectedSelectionIds.add(s.selectionId));
      updateView();
    });

    container.querySelector('#btn-deselect-all')?.addEventListener('click', () => {
      selectedSelectionIds.clear();
      updateView();
    });

    container.querySelector('#btn-select-actions')?.addEventListener('click', () => {
      selectedSelectionIds.clear();
      companySelections.forEach(s => {
        if (s.phase !== '選考終了' && (s.progressStatus === '実施済み・結果待ち' || s.progressStatus === '未対応' || s.companyConfirmationItem)) {
          selectedSelectionIds.add(s.selectionId);
        }
      });
      updateView();
    });

    // Excel出力 (指示書 17, 28項)
    container.querySelector('#btn-export-excel')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const filename = `${submissionPurpose}_${currentCompany.name}_${new Date().toISOString().split('T')[0]}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
      exportCompanyToExcel(currentCompany, targetSelections, filename);

      // 履歴保存 (指示書 25項)
      store.saveCompanySubmission({
        companyId: currentCompany.companyId,
        submissionPurpose,
        outputType: 'EXCEL',
        selectionIds: targetSelections.map(s => s.selectionId),
        candidateIds: targetSelections.map(s => s.candidateId),
        jobIds: targetSelections.map(s => s.jobId)
      });

      alert(`Excelファイル「${filename}」を出力し、提出履歴に記録しました。`);
      updateView();
    });

    // CSV出力 (指示書 16, 28項)
    container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const filename = `${submissionPurpose}_${currentCompany.name}_${new Date().toISOString().split('T')[0]}.csv`.replace(/[\\/:*?"<>|]/g, '_');
      exportCompanyToCsv(currentCompany, targetSelections, filename);

      store.saveCompanySubmission({
        companyId: currentCompany.companyId,
        submissionPurpose,
        outputType: 'CSV',
        selectionIds: targetSelections.map(s => s.selectionId),
        candidateIds: targetSelections.map(s => s.candidateId),
        jobIds: targetSelections.map(s => s.jobId)
      });

      alert(`CSVファイル「${filename}」を出力し、提出履歴に記録しました。`);
      updateView();
    });

    // メール作成モーダル連携 (指示書 18, 19項)
    container.querySelector('#btn-export-email')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const selectionIds = targetSelections.map(s => s.selectionId);
      openEmailComposerModal(currentCompany.companyId, () => {
        store.saveCompanySubmission({
          companyId: currentCompany.companyId,
          submissionPurpose,
          outputType: 'EMAIL',
          selectionIds,
          candidateIds: targetSelections.map(s => s.candidateId),
          jobIds: targetSelections.map(s => s.jobId)
        });
        updateView();
      }, selectionIds);
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}


/**
 * 選考進捗・ヨミ管理システム - 求人・ポジション別画面コンポーネント
 */



function renderJobView(container, { onOpenDetail }) {
  const jobs = store.getJobs();
  const companies = store.getCompanies();
  const selections = store.getSelections();
  const candidates = store.getCandidates();

  const companiesMap = new Map(companies.map(c => [c.companyId, c]));
  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));

  let selectedJobId = jobs[0] ? jobs[0].jobId : '';

  function updateView() {
    const job = jobs.find(j => j.jobId === selectedJobId) || jobs[0];
    if (!job) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400">求人マスタが登録されていません。</div>';
      return;
    }

    const company = companiesMap.get(job.companyId);
    const jobSelections = selections.filter(s => !s.isArchived && s.jobId === job.jobId);

    // 各フェーズ人数
    const recCount = jobSelections.length;
    const docCount = jobSelections.filter(s => s.phase === '書類選考' || s.phase === '推薦準備').length;
    const interviewCount = jobSelections.filter(s => s.phase === '一次面接' || s.phase === '二次面接').length;
    const finalCount = jobSelections.filter(s => s.phase === '最終面接').length;
    const offerCount = jobSelections.filter(s => s.phase === 'オファー面談・条件提示' || s.phase === '内定').length;
    const acceptedCount = jobSelections.filter(s => s.phase === '内定承諾' || s.phase === '入社予定').length;
    const endedCount = jobSelections.filter(s => s.phase === '選考終了').length;
    const totalYomi = jobSelections.reduce((sum, s) => sum + (s.phase !== '選考終了' ? Number(s.yomi || 0) : 0), 0);

    // 平均選考日数の計算 (推薦日〜現在または終了日)
    let totalDays = 0;
    let validCount = 0;
    const today = new Date();

    jobSelections.forEach(s => {
      if (s.recommendationDate) {
        const start = new Date(s.recommendationDate);
        const end = s.selectionEndDate ? new Date(s.selectionEndDate) : today;
        const diff = Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
        totalDays += diff;
        validCount++;
      }
    });

    const avgDays = validCount > 0 ? Math.round(totalDays / validCount) : 0;

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & 求人切り替え -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">${job.title}</h2>
              <span class="px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded font-bold text-xs">${job.status}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">企業名: ${company ? company.name : '不明'} / 勤務地: ${job.location || '未定'} / 雇用形態: ${job.employmentType || '正社員'}</p>
          </div>

          <div class="flex items-center space-x-2 text-xs">
            <span class="text-slate-500 font-semibold">求人ポジション切替:</span>
            <select id="select-job-change" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              ${jobs.map(j => {
                const comp = companiesMap.get(j.companyId);
                return `<option value="${j.jobId}" ${j.jobId === job.jobId ? 'selected' : ''}>${j.title} (${comp ? comp.name : ''})</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <!-- 求人KPI -->
        <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 text-center text-xs">
          <div class="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
            <div class="text-slate-500 font-semibold">推薦総数</div>
            <div class="text-xl font-black text-slate-800 mt-1">${recCount}名</div>
          </div>
          <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-sm">
            <div class="text-slate-600 font-semibold">書類選考中</div>
            <div class="text-xl font-black text-slate-700 mt-1">${docCount}名</div>
          </div>
          <div class="bg-blue-50 border border-blue-200 p-3 rounded-xl shadow-sm">
            <div class="text-blue-800 font-semibold">面接中</div>
            <div class="text-xl font-black text-blue-600 mt-1">${interviewCount}名</div>
          </div>
          <div class="bg-indigo-50 border border-indigo-200 p-3 rounded-xl shadow-sm">
            <div class="text-indigo-800 font-semibold">最終面接</div>
            <div class="text-xl font-black text-indigo-600 mt-1">${finalCount}名</div>
          </div>
          <div class="bg-purple-50 border border-purple-200 p-3 rounded-xl shadow-sm">
            <div class="text-purple-800 font-semibold">オファー・内定</div>
            <div class="text-xl font-black text-purple-600 mt-1">${offerCount}名</div>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-xl shadow-sm">
            <div class="text-emerald-800 font-semibold">内定承諾</div>
            <div class="text-xl font-black text-emerald-600 mt-1">${acceptedCount}名</div>
          </div>
          <div class="bg-rose-50 border border-rose-200 p-3 rounded-xl shadow-sm">
            <div class="text-rose-800 font-semibold">選考終了</div>
            <div class="text-xl font-black text-rose-600 mt-1">${endedCount}名</div>
          </div>
          <div class="bg-slate-900 text-white p-3 rounded-xl shadow-sm">
            <div class="text-slate-400 font-semibold">平均選考日数</div>
            <div class="text-xl font-black text-white mt-1">${avgDays}日</div>
          </div>
        </div>

        <!-- 候補者一覧 -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">この求人の選考中候補者一覧 (${jobSelections.length}名)</h3>
            <span class="text-xs text-indigo-700 font-bold">ヨミ合計: ${Math.round(totalYomi * 100) / 100}件</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">推薦日</th>
                  <th class="px-4 py-3">選考フェーズ</th>
                  <th class="px-4 py-3">進行状態</th>
                  <th class="px-4 py-3 text-right">ヨミ</th>
                  <th class="px-4 py-3">次回予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${jobSelections.length === 0 ? `
                  <tr><td colspan="7" class="text-center py-8 text-slate-400">該当する選考案件がありません。</td></tr>
                ` : jobSelections.map(s => {
                  const cand = candidatesMap.get(s.candidateId);
                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">${cand ? cand.name : ''}</td>
                      <td class="px-4 py-2.5 text-slate-500">${s.recommendationDate || '-'}</td>
                      <td class="px-4 py-2.5 font-bold text-indigo-700">${s.phase}</td>
                      <td class="px-4 py-2.5 text-slate-700">${s.progressStatus}</td>
                      <td class="px-4 py-2.5 text-right font-black text-indigo-600">${s.yomi * 100}%</td>
                      <td class="px-4 py-2.5 text-slate-600">${s.nextScheduleDate || '-'}</td>
                      <td class="px-3 py-2.5 text-center">
                        <button class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-xs transition" data-id="${s.selectionId}">詳細</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#select-job-change')?.addEventListener('change', (e) => { selectedJobId = e.target.value; updateView(); });
    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}


/**
 * 選考進捗・ヨミ管理システム - マスタ管理画面コンポーネント (各マスタ専用編集・2段階削除/復元・関連データ保護・引き継ぎ・状態維持対応)
 */




const MASTER_STORAGE_KEY = 'master_management_active_state';

function getSavedMasterState() {
  try {
    const raw = sessionStorage.getItem(MASTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveMasterState(state) {
  try {
    const current = getSavedMasterState();
    sessionStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

function renderMasterManagement(container) {
  const savedState = getSavedMasterState();

  let activeTab = savedState.activeTab || 'candidates';
  let targetFiscalYear = savedState.targetFiscalYear || 2025;
  let viewFilterMode = savedState.viewFilterMode || 'activeOnly'; // activeOnly | includeInactive | includeArchived | all (指示書 18項)
  const isAdmin = store.isAdmin();

  function updateView() {
    const consultants = store.getConsultants(true);
    const companies = store.getCompanies(true);
    const jobs = store.getJobs(true);
    const candidates = store.getCandidates(true);
    const qTargets = store.getQTargets(targetFiscalYear, 'ALL');

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const caConsultants = store.getCaConsultants();
    const raConsultants = store.getRaConsultants();

    saveMasterState({
      activeTab,
      targetFiscalYear,
      viewFilterMode,
      scrollTop: window.scrollY || document.documentElement.scrollTop
    });

    // フィルタリング処理 (指示書 18項)
    const filterItems = (list) => {
      if (viewFilterMode === 'activeOnly') {
        return list.filter(item => !item.isArchived && item.status !== 'inactive');
      }
      if (viewFilterMode === 'includeInactive') {
        return list.filter(item => !item.isArchived);
      }
      if (viewFilterMode === 'includeArchived') {
        return list;
      }
      return list;
    };

    container.innerHTML = `
      <div class="space-y-6 text-xs">
        <!-- ヘッダー & タブ & フィルター切り替え (指示書 18項) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
              マスタ管理
            </h2>
            <p class="text-xs text-slate-500 mt-1">候補者、企業、求人、コンサルタント(CA/RA)、四半期(Q)個人目標の一括編集・安全アーカイブ</p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <!-- 一覧表示フィルター (指示書 18項) -->
            <div class="flex items-center space-x-1">
              <span class="font-bold text-slate-700">表示対象:</span>
              <select id="select-view-filter-mode" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
                <option value="activeOnly" ${viewFilterMode === 'activeOnly' ? 'selected' : ''}>有効のみ (標準)</option>
                <option value="includeInactive" ${viewFilterMode === 'includeInactive' ? 'selected' : ''}>無効を含む</option>
                <option value="includeArchived" ${viewFilterMode === 'includeArchived' ? 'selected' : ''}>アーカイブを含む</option>
              </select>
            </div>

            <!-- マスタ切り替えタブ -->
            <div class="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-xs font-bold">
              <button data-tab="candidates" class="px-3 py-2 rounded-md transition ${activeTab === 'candidates' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                候補者 (${candidates.filter(c => !c.isArchived).length})
              </button>
              <button data-tab="companies" class="px-3 py-2 rounded-md transition ${activeTab === 'companies' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                企業 (${companies.filter(c => !c.isArchived).length})
              </button>
              <button data-tab="jobs" class="px-3 py-2 rounded-md transition ${activeTab === 'jobs' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                求人 (${jobs.filter(j => !j.isArchived).length})
              </button>
              ${isAdmin ? `
                <button data-tab="consultants" class="px-3 py-2 rounded-md transition ${activeTab === 'consultants' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                  コンサル (CA/RA)
                </button>
                <button data-tab="targets" class="px-3 py-2 rounded-md transition ${activeTab === 'targets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">
                  個人Q目標管理
                </button>
                <button data-tab="data_management" class="px-3 py-2 rounded-md transition ${activeTab === 'data_management' ? 'bg-rose-600 text-white shadow font-black' : 'text-rose-700 bg-rose-50 hover:bg-rose-100'}">
                  ⚙️ データ管理・初期化
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          ${activeTab === 'candidates' ? renderCandidateMaster(filterItems(candidates), consultantsMap, caConsultants, isAdmin) : ''}
          ${activeTab === 'companies' ? renderCompanyMaster(filterItems(companies), consultantsMap, raConsultants, isAdmin) : ''}
          ${activeTab === 'jobs' ? renderJobMaster(filterItems(jobs), companiesMap, consultantsMap, raConsultants, isAdmin) : ''}
          ${activeTab === 'consultants' && isAdmin ? renderConsultantMaster(filterItems(consultants)) : ''}
          ${activeTab === 'targets' && isAdmin ? renderQTargetMaster(consultants, qTargets, targetFiscalYear, (fy) => { targetFiscalYear = fy; saveMasterState({ targetFiscalYear: fy }); updateView(); }) : ''}
          ${activeTab === 'data_management' && isAdmin ? renderDataManagementSection(updateView) : ''}
        </div>
      </div>
    `;

    container.querySelector('#select-view-filter-mode')?.addEventListener('change', (e) => {
      viewFilterMode = e.target.value;
      saveMasterState({ viewFilterMode });
      updateView();
    });

    container.querySelectorAll('button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        saveMasterState({ activeTab });
        updateView();
      });
    });

    bindMasterEvents(container, updateView, targetFiscalYear);
  }

  updateView();
}

/**
 * 候補者マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 7, 12, 18項)
 */
function renderCandidateMaster(candidates, consultantsMap, caConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">候補者マスタ一覧</h3>
        <button id="btn-add-candidate-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規候補者登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">管理番号</th>
              <th class="px-3 py-2.5">候補者名 (フリガナ)</th>
              <th class="px-3 py-2.5">担当CA</th>
              <th class="px-3 py-2.5">活動状態</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${candidates.map(c => {
              const ca = consultantsMap.get(c.caId || c.caConsultantId);
              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-mono text-slate-600">${c.internalManagementNumber || '-'}</td>
                  <td class="px-3 py-2.5 font-bold text-slate-900">
                    ${c.name} <span class="text-slate-400 font-normal">(${c.kana || ''})</span>
                  </td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${ca ? ca.name : '未設定'}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium">${c.activityStatus || '選考中'}</span></td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-candidate px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.candidateId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="candidate" data-id="${c.candidateId}" data-name="${c.name}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 企業マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 8, 12, 18項)
 */
function renderCompanyMaster(companies, consultantsMap, raConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">企業マスタ一覧</h3>
        <button id="btn-add-company-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規企業登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">企業名</th>
              <th class="px-3 py-2.5">ランク</th>
              <th class="px-3 py-2.5">主担当RA</th>
              <th class="px-3 py-2.5">人事担当者</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${companies.map(c => {
              const rankBadge = COMPANY_RANK_BADGES[c.rank] || COMPANY_RANK_BADGES['B'];
              const ra = consultantsMap.get(c.primaryRaId || c.raConsultantId);
              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${rankBadge.badgeClass}">${rankBadge.label}</span></td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${ra ? ra.name : '未設定'}</td>
                  <td class="px-3 py-2.5 text-slate-800">${c.contactPerson || c.contactName || '-'} (${c.contactEmail || '-'})</td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-company px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.companyId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="company" data-id="${c.companyId}" data-name="${c.name}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 求人マスタ一覧 (編集・アーカイブ・復元・完全削除対応) (指示書 4, 5, 9, 12, 18項)
 */
function renderJobMaster(jobs, companiesMap, consultantsMap, raConsultants, isAdmin) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">求人・ポジションマスタ一覧</h3>
        <button id="btn-add-job-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          + 新規求人登録
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">求人名</th>
              <th class="px-3 py-2.5">対象企業</th>
              <th class="px-3 py-2.5">勤務地</th>
              <th class="px-3 py-2.5">募集状態</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${jobs.map(j => {
              const comp = companiesMap.get(j.companyId);
              return `
                <tr class="${j.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${j.title || j.jobName}</td>
                  <td class="px-3 py-2.5 font-semibold text-indigo-700">${comp ? comp.name : (j.companyName || '未設定')}</td>
                  <td class="px-3 py-2.5 text-slate-600">${j.location || '-'}</td>
                  <td class="px-3 py-2.5"><span class="px-2 py-0.5 bg-slate-100 rounded font-bold text-slate-800">${j.status || '募集中'}</span></td>
                  <td class="px-3 py-2.5">
                    ${j.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>'}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-job px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${j.jobId}">編集</button>
                    ${!j.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}" data-name="${j.title || j.jobName}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}">復元</button>
                      ${isAdmin ? `<button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="job" data-id="${j.jobId}" data-name="${j.title || j.jobName}">完全削除</button>` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * コンサルタントマスタ一覧 (編集・アーカイブ・復元・完全削除・引き継ぎ対応) (指示書 4, 5, 10, 11, 12, 18項)
 */
function renderConsultantMaster(consultants) {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-800 text-sm">コンサルタントマスタ一覧</h3>
        <button id="btn-add-consultant-modal" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow transition">
          ＋ 新規コンサルを追加
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">氏名</th>
              <th class="px-3 py-2.5">メールアドレス</th>
              <th class="px-3 py-2.5">役割区分</th>
              <th class="px-3 py-2.5">状態</th>
              <th class="px-3 py-2.5 text-center">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${consultants.map(c => {
              const isEff = c.status !== 'inactive' && !c.isArchived;
              const rolesList = (c.roles && Array.isArray(c.roles) && c.roles.length > 0)
                ? c.roles
                : [c.roleType || 'CA'];

              const roleBadgesHTML = rolesList.map(r => {
                if (r === 'CA') return '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-200 font-extrabold rounded text-[11px] mr-1">CA</span>';
                if (r === 'RA') return '<span class="px-2 py-0.5 bg-purple-100 text-purple-800 border border-purple-200 font-extrabold rounded text-[11px] mr-1">RA</span>';
                if (r === 'ADMIN') return '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-200 font-extrabold rounded text-[11px] mr-1">管理者</span>';
                return `<span class="px-2 py-0.5 bg-slate-100 text-slate-800 font-bold rounded text-[11px] mr-1">${r}</span>`;
              }).join('');

              return `
                <tr class="${c.isArchived ? 'bg-slate-100/80 text-slate-400' : 'hover:bg-slate-50'} transition">
                  <td class="px-3 py-2.5 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-2.5 font-mono text-slate-600">${c.email}</td>
                  <td class="px-3 py-2.5 font-bold">${roleBadgesHTML}</td>
                  <td class="px-3 py-2.5">
                    ${c.isArchived 
                      ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-bold rounded">アーカイブ済み</span>' 
                      : (isEff ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">有効</span>' : '<span class="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold rounded">無効</span>')}
                  </td>
                  <td class="px-3 py-2.5 text-center space-x-1 font-bold">
                    <button class="btn-edit-consultant px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] transition" data-id="${c.consultantId}">編集</button>
                    ${!c.isArchived ? `
                      <button class="btn-archive-item px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}" data-name="${c.name}">アーカイブ</button>
                    ` : `
                      <button class="btn-restore-item px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}">復元</button>
                      <button class="btn-delete-perm-item px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded text-[11px] transition" data-type="consultant" data-id="${c.consultantId}" data-name="${c.name}">完全削除</button>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderQTargetMaster(consultants, qTargets, targetFiscalYear, onYearChange) {
  const caConsultants = consultants.filter(c => !c.isArchived && (c.roleType === 'CA' || c.role === 'member' && !c.roleType));
  const qTargetMap = new Map();

  qTargets.forEach(t => {
    const key = `${t.consultantId}_${t.quarter}`;
    qTargetMap.set(key, Number(t.targetCount || 0));
  });

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-slate-800 text-sm">個人四半期（Q）目標の一括設定 (CAのみ対象)</h3>
          <p class="text-xs text-slate-500">10月開始の年度のCA個人目標件数を設定します。※RAおよび管理者は個人目標対象外です。</p>
        </div>

        <div class="flex items-center space-x-2 text-xs">
          <span class="font-bold text-slate-700">対象年度:</span>
          <select id="select-target-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none">
            <option value="2025" ${targetFiscalYear === 2025 ? 'selected' : ''}>2025年度 (2025/10〜2026/09)</option>
            <option value="2026" ${targetFiscalYear === 2026 ? 'selected' : ''}>2026年度 (2026/10〜2027/09)</option>
          </select>
        </div>
      </div>

      <div id="q-target-toast" class="hidden p-3 rounded-lg text-xs font-bold transition"></div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs bg-white border border-slate-200 rounded-lg">
          <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
            <tr>
              <th class="px-4 py-3">コンサルタント名 (CA)</th>
              <th class="px-3 py-3">役割</th>
              <th class="px-3 py-3 text-center">1Q目標 (10-12月)</th>
              <th class="px-3 py-3 text-center">2Q目標 (1-3月)</th>
              <th class="px-3 py-3 text-center">3Q目標 (4-6月)</th>
              <th class="px-3 py-3 text-center">4Q目標 (7-9月)</th>
              <th class="px-3 py-3 text-right">年度通期合計</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${caConsultants.length === 0 ? `
              <tr><td colspan="7" class="text-center py-8 text-slate-400">目標設定対象のCAコンサルタントが登録されていません。</td></tr>
            ` : caConsultants.map(c => {
              const q1 = qTargetMap.get(`${c.consultantId}_Q1`) || 0;
              const q2 = qTargetMap.get(`${c.consultantId}_Q2`) || 0;
              const q3 = qTargetMap.get(`${c.consultantId}_Q3`) || 0;
              const q4 = qTargetMap.get(`${c.consultantId}_Q4`) || 0;
              const yearTotal = q1 + q2 + q3 + q4;

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="px-4 py-3 font-bold text-slate-900">${c.name}</td>
                  <td class="px-3 py-3 text-indigo-700 font-semibold">CA</td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q1}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q1" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q2}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q2" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q3}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q3" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-2 text-center">
                    <input type="number" min="0" value="${q4}" class="input-q-target w-20 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-900 focus:bg-white focus:border-indigo-600" data-consultant-id="${c.consultantId}" data-quarter="Q4" data-consultant-name="${c.name}">
                  </td>

                  <td class="px-3 py-3 text-right font-black text-indigo-700 text-sm">
                    ${yearTotal}件
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindMasterEvents(container, updateView, targetFiscalYear) {
  container.querySelector('#select-target-fiscal-year')?.addEventListener('change', (e) => {
    const fy = parseInt(e.target.value, 10);
    saveMasterState({ targetFiscalYear: fy });
    updateView();
  });

  container.querySelectorAll('.input-q-target').forEach(input => {
    input.addEventListener('change', (e) => {
      const cId = input.getAttribute('data-consultant-id');
      const q = input.getAttribute('data-quarter');
      const cName = input.getAttribute('data-consultant-name');
      const val = Number(e.target.value);

      const toastEl = container.querySelector('#q-target-toast');
      if (toastEl) {
        toastEl.className = 'p-3 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg text-xs font-bold';
        toastEl.textContent = '個人Q目標を保存しました。';
        toastEl.classList.remove('hidden');
        setTimeout(() => toastEl.classList.add('hidden'), 3000);
      }

      store.saveQTarget({
        consultantId: cId,
        consultantName: cName,
        fiscalYear: targetFiscalYear,
        quarter: q,
        targetCount: val
      });
    });
  });

  // 1. アーカイブ操作 (指示書 3, 6項)
  container.querySelectorAll('.btn-archive-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');

      // コンサル無効化/アーカイブ時の担当引き継ぎチェック (指示書 11項)
      if (type === 'consultant') {
        const counts = store.getRelatedDataCounts('consultant', id);
        if (counts.hasRelatedData) {
          openReassignModal(id, name, counts, () => {
            store.archiveMasterItem('consultant', id, 'マスタ管理画面からのアーカイブ');
            updateView();
          });
          return;
        }
      }

      if (confirm(`【アーカイブ確認】\n「${name}」をアーカイブしますか？\n\n・通常の一覧や選択候補から非表示になります。\n・関連する選考案件や履歴は削除されません。`)) {
        store.archiveMasterItem(type, id, 'マスタ管理画面からのアーカイブ');
        updateView();
      }
    });
  });

  // 2. 復元操作 (指示书 12項)
  container.querySelectorAll('.btn-restore-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      if (confirm('【復元確認】\nこのデータを復元しますか？\n通常の一覧や選択候補に再表示されます。')) {
        store.restoreMasterItem(type, id);
        updateView();
      }
    });
  });

  // 3. 管理者限定 完全物理削除 (指示書 3, 6, 7, 8, 9, 10項)
  container.querySelectorAll('.btn-delete-perm-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');

      // 関連データ件数チェック (指示書 7, 8, 9, 10項)
      const counts = store.getRelatedDataCounts(type, id);
      if (counts.hasRelatedData) {
        let warningText = `【完全削除不可の警告】\n「${name}」には以下の関連データが存在するため、完全に削除することはできません。\n\n`;
        if (type === 'candidate') warningText += `・選考案件: ${counts.totalSelectionCount}件\n`;
        if (type === 'company') warningText += `・求人: ${counts.totalJobCount}件\n・選考案件: ${counts.totalSelectionCount}件\n・連絡履歴: ${counts.commCount}件\n・提出履歴: ${counts.subCount}件\n`;
        if (type === 'job') warningText += `・選考案件: ${counts.totalSelectionCount}件\n`;
        if (type === 'consultant') warningText += `・担当候補者: ${counts.caCandidateCount}件\n・担当企業: ${counts.raCompanyCount}件\n・選考案件: ${counts.selectionCount}件\n`;

        warningText += `\n過去の選考記録や履歴を保全するため、アーカイブ機能をご利用ください。`;
        alert(warningText);
        return;
      }

      if (confirm(`【管理者用 完全削除確認】\n「${name}」を完全に削除しますか？\n\n※この操作は取り消せません。`)) {
        store.deleteMasterItemPermanently(type, id);
        updateView();
      }
    });
  });

  // 4. 新規モーダルの呼び出し
  container.querySelector('#btn-add-company-modal')?.addEventListener('click', () => {
    openCompanyFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-job-modal')?.addEventListener('click', () => {
    openJobFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-consultant-modal')?.addEventListener('click', () => {
    openConsultantFormModal(null, () => updateView());
  });

  container.querySelector('#btn-add-candidate-modal')?.addEventListener('click', () => {
    openCandidateFormModal(null, () => updateView());
  });

  // 5. 編集モーダルの呼び出し (指示書 5項)
  container.querySelectorAll('.btn-edit-candidate').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const cand = store.getCandidates(true).find(c => c.candidateId === id);
      if (cand) openCandidateFormModal(cand, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-company').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const comp = store.getCompanies(true).find(c => c.companyId === id);
      if (comp) openCompanyFormModal(comp, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-job').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const job = store.getJobs(true).find(j => j.jobId === id);
      if (job) openJobFormModal(job, () => updateView());
    });
  });

  container.querySelectorAll('.btn-edit-consultant').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const cons = store.getConsultants(true).find(c => c.consultantId === id);
      if (cons) openConsultantFormModal(cons, () => updateView());
    });
  });
}

/**
 * 候補者 登録・編集モーダル (指示書 5項)
 */
function openCandidateFormModal(candidate = null, onClose) {
  let modalEl = document.getElementById('candidate-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!candidate;
  const caConsultants = store.getCaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'candidate-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  const currentEntrySource = candidate ? (candidate.entrySource || 'UNSET') : 'UNSET';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '候補者情報の編集' : '新規候補者の登録'}</h3>
        <button id="btn-cand-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-cand" class="space-y-4" onsubmit="return false;">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">候補者名 <span class="text-rose-500">*</span></label>
            <input type="text" id="cand-name" value="${candidate ? candidate.name : ''}" required placeholder="山田 太郎" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">フリガナ</label>
            <input type="text" id="cand-kana" value="${candidate ? (candidate.kana || '') : ''}" placeholder="ヤマダ タロウ" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">担当CA <span class="text-rose-500">*</span></label>
            <select id="cand-ca-id" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-700 focus:outline-none">
              ${caConsultants.map(c => `<option value="${c.consultantId}" ${candidate && (candidate.caId || candidate.caConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (CA)</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">活動状態</label>
            <input type="text" id="cand-status" value="${candidate ? (candidate.activityStatus || '選考中') : '選考中'}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none font-semibold">
          </div>
        </div>

        <!-- エントリー経路 -->
        <div class="grid grid-cols-2 gap-3 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
          <div>
            <label class="block font-bold text-slate-800 mb-1">代表エントリー経路</label>
            <select id="cand-entry-source" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold focus:outline-none">
              <option value="UNSET">未設定</option>
              ${ENTRY_SOURCES.map(s => `<option value="${s.code}" ${currentEntrySource === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-800 mb-1">パスアップ/経路詳細</label>
            <input type="text" id="cand-entry-detail" value="${candidate ? (candidate.entrySourceDetail || '') : ''}" placeholder="例: 若山さんスカウト" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-bold focus:outline-none">
          </div>
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">備考</label>
          <textarea id="cand-remarks" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none">${candidate ? (candidate.remarks || '') : ''}</textarea>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-cand-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-cand-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-cand-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#cand-name').value.trim();
    const kana = modalEl.querySelector('#cand-kana').value.trim();
    const caId = modalEl.querySelector('#cand-ca-id').value;
    const activityStatus = modalEl.querySelector('#cand-status').value;
    const entrySource = modalEl.querySelector('#cand-entry-source').value;
    const entrySourceDetail = modalEl.querySelector('#cand-entry-detail').value.trim();
    const remarks = modalEl.querySelector('#cand-remarks').value;

    if (!name) {
      alert('候補者名を入力してください。');
      return;
    }

    store.saveCandidate({
      candidateId: candidate ? candidate.candidateId : undefined,
      name,
      kana: kana || name,
      caId,
      caConsultantId: caId,
      activityStatus,
      entrySource,
      entrySourceDetail,
      remarks
    }, true);

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-cand-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-cand-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * 企業 登録・編集モーダル (指示書 5項)
 */
function openCompanyFormModal(company = null, onClose) {
  let modalEl = document.getElementById('company-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!company;
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'company-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '企業情報の編集' : '新規企業の登録'}</h3>
        <button id="btn-comp-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-comp" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">企業名 <span class="text-rose-500">*</span></label>
          <input type="text" id="comp-name" value="${company ? company.name : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">企業ランク</label>
            <select id="comp-rank" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${COMPANY_RANKS.map(r => `<option value="${r}" ${company && company.rank === r ? 'selected' : ''}>ランク: ${r}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">主担当RA</label>
            <select id="comp-ra-id" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${company && (company.primaryRaId || company.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div>
            <label class="block font-bold text-slate-700 mb-1">人事担当者名</label>
            <input type="text" id="comp-contact-name" value="${company ? (company.contactPerson || company.contactName || '') : ''}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>

          <div>
            <label class="block font-bold text-slate-700 mb-1">人事担当者メール</label>
            <input type="email" id="comp-contact-email" value="${company ? (company.contactEmail || '') : ''}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">備考</label>
          <textarea id="comp-remarks" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none">${company ? (company.remarks || '') : ''}</textarea>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-comp-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-comp-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-comp-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#comp-name').value.trim();
    const rank = modalEl.querySelector('#comp-rank').value;
    const raId = modalEl.querySelector('#comp-ra-id').value;
    const contactName = modalEl.querySelector('#comp-contact-name').value.trim();
    const contactEmail = modalEl.querySelector('#comp-contact-email').value.trim();
    const remarks = modalEl.querySelector('#comp-remarks').value;

    if (!name) {
      alert('企業名を入力してください。');
      return;
    }

    if (contactEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        alert('メールアドレスの形式を確認してください。');
        return;
      }
    }

    store.saveCompany({
      companyId: company ? company.companyId : undefined,
      name,
      rank,
      primaryRaId: raId,
      contactName,
      contactPerson: contactName,
      contactEmail,
      remarks,
      checkIntervalDays: 3
    }, true);

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-comp-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-comp-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * 求人 登録・編集モーダル (指示書 5項)
 */
function openJobFormModal(job = null, onClose) {
  let modalEl = document.getElementById('job-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!job;
  const companies = store.getCompanies();
  const raConsultants = store.getRaConsultants();

  modalEl = document.createElement('div');
  modalEl.id = 'job-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? '求人情報の編集' : '新規求人の登録'}</h3>
        <button id="btn-job-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-job" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">求人名 (ポジション名) <span class="text-rose-500">*</span></label>
          <input type="text" id="job-title" value="${job ? (job.title || job.jobName) : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">対象企業 <span class="text-rose-500">*</span></label>
          <select id="job-company-id" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
            <option value="">-- 対象企業を選択してください --</option>
            ${companies.map(c => `<option value="${c.companyId}" ${job && job.companyId === c.companyId ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block font-bold text-slate-800 mb-1">勤務地</label>
            <input type="text" id="job-location" value="${job ? (job.location || '') : ''}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">募集状態</label>
            <select id="job-status" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${JOB_STATUSES.map(st => `<option value="${st}" ${job && job.status === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-800 mb-1">求人担当RA</label>
            <select id="job-ra-id" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              ${raConsultants.map(c => `<option value="${c.consultantId}" ${job && (job.raId || job.raConsultantId) === c.consultantId ? 'selected' : ''}>${c.name} (RA)</option>`).join('')}
            </select>
          </div>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-job-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-job-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '登録する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-job-submit')?.addEventListener('click', () => {
    const title = modalEl.querySelector('#job-title').value.trim();
    const companyId = modalEl.querySelector('#job-company-id').value;
    const location = modalEl.querySelector('#job-location').value.trim();
    const status = modalEl.querySelector('#job-status').value;
    const raId = modalEl.querySelector('#job-ra-id').value;

    if (!title) {
      alert('求人名を入力してください。');
      return;
    }
    if (!companyId) {
      alert('対象企業を選択してください。');
      return;
    }

    store.saveJob({
      jobId: job ? job.jobId : undefined,
      title,
      jobName: title,
      companyId,
      location,
      status,
      raId
    });

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-job-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-job-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * コンサル 登録・編集モーダル (指示書 2, 4, 5, 13, 15項)
 */
function openConsultantFormModal(consultant = null, onClose) {
  let modalEl = document.getElementById('consultant-form-modal');
  if (modalEl) modalEl.remove();

  const isEdit = !!consultant;
  const currentRoles = (consultant && consultant.roles && Array.isArray(consultant.roles))
    ? consultant.roles
    : (consultant ? [consultant.roleType || 'CA'] : ['CA']);

  const hasCA = currentRoles.includes('CA');
  const hasRA = currentRoles.includes('RA');
  const hasAdmin = currentRoles.includes('ADMIN');

  modalEl = document.createElement('div');
  modalEl.id = 'consultant-form-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <h3 class="text-base font-bold text-slate-800">${isEdit ? 'コンサルタント情報の編集' : '＋ 新規コンサルタントの追加'}</h3>
        <button id="btn-cons-modal-close" class="text-slate-400 hover:text-slate-600 p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <form id="form-cons" class="space-y-4" onsubmit="return false;">
        <div>
          <label class="block font-bold text-slate-800 mb-1">氏名 <span class="text-rose-500">*</span></label>
          <input type="text" id="cons-name" value="${consultant ? consultant.name : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">メールアドレス <span class="text-rose-500">*</span></label>
          <input type="email" id="cons-email" value="${consultant ? consultant.email : ''}" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none">
        </div>

        <!-- 役割 複数選択チェックボックス (指示書 2, 13項) -->
        <div class="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <label class="block font-bold text-slate-800">担当役割 (複数選択可) <span class="text-rose-500">*</span></label>
          <div class="flex flex-wrap items-center gap-4 pt-1 font-bold text-slate-700">
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="CA" ${hasCA ? 'checked' : ''}>
              <span>CA (キャリアアドバイザー)</span>
            </label>
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="RA" ${hasRA ? 'checked' : ''}>
              <span>RA (リクルーティングアドバイザー)</span>
            </label>
            <label class="inline-flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" class="chk-cons-role rounded text-indigo-600 focus:ring-indigo-500" value="ADMIN" ${hasAdmin ? 'checked' : ''}>
              <span>管理者 (ADMIN)</span>
            </label>
          </div>
          <p class="text-[11px] text-slate-500 mt-1">※CAとRAの両方にチェックを入れると両面担当者として登録されます。</p>
        </div>

        <div>
          <label class="block font-bold text-slate-800 mb-1">有効・無効 <span class="text-rose-500">*</span></label>
          <select id="cons-status" required class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
            <option value="active" ${!consultant || consultant.status !== 'inactive' ? 'selected' : ''}>有効</option>
            <option value="inactive" ${consultant && consultant.status === 'inactive' ? 'selected' : ''}>無効</option>
          </select>
        </div>
      </form>

      <div class="flex items-center justify-end space-x-3 border-t border-slate-200 pt-3">
        <button id="btn-cons-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition">キャンセル</button>
        <button id="btn-cons-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">${isEdit ? '更新保存' : '追加する'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-cons-submit')?.addEventListener('click', () => {
    const name = modalEl.querySelector('#cons-name').value.trim();
    const email = modalEl.querySelector('#cons-email').value.trim();
    const status = modalEl.querySelector('#cons-status').value;

    if (!name || !email) {
      alert('氏名およびメールアドレスは必須入力です。');
      return;
    }

    // チェックされた役割の収集
    const checkedRoles = Array.from(modalEl.querySelectorAll('.chk-cons-role:checked')).map(cb => cb.value);
    if (checkedRoles.length === 0) {
      alert('役割を少なくとも1つ選択してください。（CA、RA、管理者のいずれか）');
      return;
    }

    const currentConsId = consultant ? consultant.consultantId : null;

    // 役割解除時の既存案件参照チェック (指示書 15項)
    if (isEdit && consultant) {
      if (hasRA && !checkedRoles.includes('RA')) {
        const raInUseCount = store.checkConsultantRoleInUse(consultant.consultantId, 'RA');
        if (raInUseCount > 0) {
          alert(`この担当者は ${raInUseCount} 件の選考案件で RA に設定されています。\nRA 役割を外す前に、該当選考案件の担当 RA を変更してください。`);
          return;
        }
      }
      if (hasCA && !checkedRoles.includes('CA')) {
        const caInUseCount = store.checkConsultantRoleInUse(consultant.consultantId, 'CA');
        if (caInUseCount > 0) {
          alert(`この担当者は ${caInUseCount} 件の選考案件で CA に設定されています。\nCA 役割を外す前に、該当選考案件の担当 CA を変更してください。`);
          return;
        }
      }
    }

    // メールアドレス重複判定 (指示書 4, 5項)
    const dupInfo = store.checkConsultantEmailDuplicateInfo(email, currentConsId, name);

    if (dupInfo.isDuplicate) {
      const existing = dupInfo.existingConsultant;

      if (!dupInfo.isSameName) {
        // 氏名が異なる場合 (指示書 5項)
        alert(`【警告: メールアドレス重複】\n\nこのメールアドレスは別の担当者に登録されています。\n\n登録済み: ${existing.name}\n入力中: ${name}\n\n登録内容を確認してください。`);
        return;
      }

      // 同一氏名の場合、既存データへ役割を追加 (指示書 4項)
      const existingRoles = (existing.roles && Array.isArray(existing.roles)) ? existing.roles : [existing.roleType || 'CA'];
      const mergedRoles = Array.from(new Set([...existingRoles, ...checkedRoles]));
      const addedRoles = checkedRoles.filter(r => !existingRoles.includes(r));

      const msg = `このメールアドレスは、すでに「${existing.name}」として登録されています。\n\n現在の役割: ${existingRoles.join('・')}\n追加する役割: ${addedRoles.length > 0 ? addedRoles.join('・') : '追加なし'}\n\n既存の担当者レコードへ役割を追加統合しますか？`;

      if (confirm(msg)) {
        store.saveConsultant({
          consultantId: existing.consultantId,
          name: existing.name,
          email: existing.email,
          roles: mergedRoles,
          roleType: mergedRoles.includes('ADMIN') ? 'ADMIN' : (mergedRoles.includes('CA') ? 'CA' : 'RA'),
          role: mergedRoles.includes('ADMIN') ? 'admin' : 'member',
          status: status
        });
        modalEl.remove();
        onClose();
      }
      return;
    }

    // 正常保存
    const primaryRoleType = checkedRoles.includes('ADMIN') ? 'ADMIN' : (checkedRoles.includes('CA') ? 'CA' : 'RA');
    store.saveConsultant({
      consultantId: currentConsId || undefined,
      name,
      email,
      roles: checkedRoles,
      roleType: primaryRoleType,
      role: primaryRoleType === 'ADMIN' ? 'admin' : 'member',
      status
    });

    modalEl.remove();
    onClose();
  });

  modalEl.querySelector('#btn-cons-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-cons-cancel')?.addEventListener('click', () => modalEl.remove());
}

/**
 * コンサル無効化/アーカイブ時の担当引き継ぎ支援モーダル (指示書 11項)
 */
function openReassignModal(fromConsultantId, fromConsultantName, counts, onProceed) {
  let modalEl = document.getElementById('reassign-modal');
  if (modalEl) modalEl.remove();

  const consultants = store.getConsultants().filter(c => c.consultantId !== fromConsultantId && !c.isArchived);

  modalEl = document.createElement('div');
  modalEl.id = 'reassign-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-xs';

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-amber-200 w-full max-w-md p-6 space-y-4 animate-fadeIn">
      <div class="flex items-center space-x-3 text-amber-600 border-b border-amber-100 pb-3">
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h4 class="font-bold text-sm text-slate-800">担当コンサルの引き継ぎ案内</h4>
      </div>

      <p class="text-slate-600 font-medium">
        コンサルタント <strong>「${fromConsultantName}」</strong> は、現在以下のデータに紐づいています。
      </p>

      <div class="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-1 font-bold text-amber-900 text-[11px]">
        <div>・担当候補者: ${counts.caCandidateCount}件</div>
        <div>・担当企業: ${counts.raCompanyCount}件</div>
        <div>・担当求人: ${counts.raJobCount}件</div>
        <div>・進行中選考案件: ${counts.selectionCount}件</div>
      </div>

      <div class="space-y-2 pt-2">
        <label class="block font-bold text-slate-800">引き継ぎ先のコンサルタントを選択:</label>
        <select id="select-reassign-target" class="w-full bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-indigo-900 focus:outline-none">
          ${consultants.map(c => `<option value="${c.consultantId}">${c.name} (${c.roleType})</option>`).join('')}
        </select>
      </div>

      <div class="space-y-2 pt-3 border-t border-slate-200">
        <button id="btn-reassign-submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">
          担当を一括引き継ぎして処理を続ける
        </button>
        <button id="btn-reassign-skip" class="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition">
          引き継ぎせずに進む
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('#btn-reassign-submit')?.addEventListener('click', () => {
    const toId = modalEl.querySelector('#select-reassign-target').value;
    if (toId) {
      store.reassignConsultantResponsibilities(fromConsultantId, toId);
    }
    modalEl.remove();
    onProceed();
  });

  modalEl.querySelector('#btn-reassign-skip')?.addEventListener('click', () => {
    modalEl.remove();
    onProceed();
  });
}

/**
 * 管理者専用 データ管理 ＆ 初期化 ＆ 監査履歴セクション (指示書 4, 5, 8, 9, 10, 16, 17, 18, 19, 21項)
 */
function renderDataManagementSection(onUpdate) {
  const previews = store.getDeletionPreviewCounts();
  const demoPreview = previews.demo;
  const allPreview = previews.all;
  const auditLogs = store.getAuditLogs();

  setTimeout(() => {
    const section = document.getElementById('data-management-container');
    if (!section) return;

    // 1. デモデータ削除ボタン
    section.querySelector('#btn-delete-demo-data')?.addEventListener('click', () => {
      if (demoPreview.total === 0) {
        alert('削除対象となるデモデータは現在存在しません。');
        return;
      }

      const msg = `【デモデータ削除の確認】\n\nデモとして登録されたデータを削除しますか？\n\n■ 削除対象データ (計 ${demoPreview.total} 件):\n・デモ選考案件: ${demoPreview.selections} 件\n・デモ候補者: ${demoPreview.candidates} 件\n・デモ求人: ${demoPreview.jobs} 件\n・デモ企業: ${demoPreview.companies} 件\n・デモ関連履歴: ${demoPreview.histories + demoPreview.companyCommunications} 件\n\n※実データおよびログインコンサルタントは削除されません。`;
      if (confirm(msg)) {
        try {
          const deleted = store.deleteDemoData();
          alert(`初期化が完了しました。\n\n・選考案件: ${deleted.selections} 件削除\n・候補者: ${deleted.candidates} 件削除\n・求人: ${deleted.jobs} 件削除\n・企業: ${deleted.companies} 件削除\n・関連履歴: ${deleted.histories + deleted.companyCommunications} 件削除`);
          onUpdate();
        } catch (err) {
          alert('エラーが発生しました: ' + err.message);
        }
      }
    });

    // 2. 種別選択削除
    section.querySelector('#btn-delete-selected-data')?.addEventListener('click', () => {
      const checkedInputs = Array.from(section.querySelectorAll('.chk-data-type:checked'));
      if (checkedInputs.length === 0) {
        alert('削除するデータ種別を1つ以上選択してください。');
        return;
      }

      const selectedTypes = checkedInputs.map(i => i.value);
      const typeNames = checkedInputs.map(i => i.getAttribute('data-name')).join('・');

      if (confirm(`選択したデータ種別（${typeNames}）を削除します。\nよろしいですか？`)) {
        try {
          store.deleteSelectedDataTypes(selectedTypes);
          alert('選択したデータ種別の削除が完了しました。');
          onUpdate();
        } catch (err) {
          alert('削除エラー: ' + err.message);
        }
      }
    });

    // 3. 全業務データ初期化 (強い確認操作: 指示書 9項)
    section.querySelector('#btn-open-reset-all-modal')?.addEventListener('click', () => {
      if (allPreview.total === 0) {
        alert('削除対象となる業務データは現在ありません。');
        return;
      }

      let modalEl = document.getElementById('modal-reset-all-confirm');
      if (modalEl) modalEl.remove();

      modalEl = document.createElement('div');
      modalEl.id = 'modal-reset-all-confirm';
      modalEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4';
      modalEl.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-rose-200 max-w-md w-full p-6 space-y-4 text-xs animate-fadeIn">
          <div class="flex items-center space-x-2 text-rose-600 font-extrabold text-base border-b border-rose-100 pb-3">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <span>全業務データの初期化 (危険操作)</span>
          </div>

          <div class="space-y-2 text-slate-700 font-medium leading-relaxed">
            <p class="text-rose-700 font-bold">この操作により、候補者・企業・求人・選考案件・関連履歴などの全業務データ (${allPreview.total} 件) が完全に削除されます。</p>
            <p class="text-slate-500 text-[11px]">※この操作は元に戻せません。管理者ログインアカウントおよびシステム設定は保護されます。</p>
          </div>

          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
            <label class="block font-bold text-slate-800">
              実行するには <span class="text-rose-600 font-mono font-black select-all">全データを初期化</span> と入力してください：
            </label>
            <input type="text" id="input-confirm-text-reset" placeholder="全データを初期化" class="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 font-bold focus:outline-none focus:border-rose-600">
          </div>

          <div class="flex items-center justify-end space-x-3 pt-2">
            <button id="btn-modal-cancel-reset" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold transition">
              キャンセル
            </button>
            <button id="btn-modal-exec-reset" disabled class="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded font-extrabold transition shadow-md">
              初期化を実行
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);

      const confirmInput = modalEl.querySelector('#input-confirm-text-reset');
      const execBtn = modalEl.querySelector('#btn-modal-exec-reset');
      const cancelBtn = modalEl.querySelector('#btn-modal-cancel-reset');

      confirmInput.addEventListener('input', () => {
        if (confirmInput.value.trim() === '全データを初期化') {
          execBtn.removeAttribute('disabled');
        } else {
          execBtn.setAttribute('disabled', 'true');
        }
      });

      cancelBtn.addEventListener('click', () => modalEl.remove());

      execBtn.addEventListener('click', () => {
        try {
          execBtn.innerText = 'データを初期化中...';
          execBtn.setAttribute('disabled', 'true');

          const resultCounts = store.resetAllBusinessData();
          modalEl.remove();
          alert(`初期化が完了しました。\n\n・選考案件: ${resultCounts.selections} 件削除\n・候補者: ${resultCounts.candidates} 件削除\n・求人: ${resultCounts.jobs} 件削除\n・企業: ${resultCounts.companies} 件削除\n・関連履歴: ${resultCounts.histories + resultCounts.companyCommunications} 件削除\n\nログインアカウントとシステム設定は保持されています。`);
          onUpdate();
        } catch (err) {
          alert('初期化エラー: ' + err.message);
          modalEl.remove();
        }
      });
    });

    // 4. 手動デモデータ再作成
    section.querySelector('#btn-seed-demo-data')?.addEventListener('click', () => {
      if (confirm('初期デモデータ（サンプル候補者・企業・求人・選考案件）を再生成しますか？')) {
        try {
          const counts = store.seedDemoData();
          alert(`デモデータの作成が完了しました。 (選考案件:${counts.selections}件, 候補者:${counts.candidates}件, 企業:${counts.companies}件)`);
          onUpdate();
        } catch (err) {
          alert('エラー: ' + err.message);
        }
      }
    });
  }, 0);

  return `
    <div id="data-management-container" class="space-y-6">
      <div class="border-b border-slate-200 pb-3">
        <h3 class="text-base font-extrabold text-slate-900 flex items-center gap-2">
          <span>⚙️ データ管理 ＆ 初期化設定</span>
          <span class="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 font-bold px-2 py-0.5 rounded">管理者専用</span>
        </h3>
        <p class="text-xs text-slate-500 mt-1">デモデータの削除、特定テーブルの削除、全業務データの初期化、および過去の操作履歴を確認できます。</p>
      </div>

      <!-- 1. デモデータのみ削除 (指示書 5-1項) -->
      <div class="bg-amber-50/70 p-5 rounded-xl border border-amber-200 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 class="font-bold text-amber-950 text-sm flex items-center gap-2">
              <span>🧹 デモデータのみ一括削除</span>
              <span class="text-xs bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full font-bold">デモ件数: 計 ${demoPreview.total} 件</span>
            </h4>
            <p class="text-xs text-slate-600 mt-1">
              初期デモとして登録された候補者・企業・求人・選考案件・履歴を一括削除します。※手動登録された実データおよびログインコンサルタントは削除されません。
            </p>
          </div>

          <button id="btn-delete-demo-data" ${demoPreview.total === 0 ? 'disabled' : ''} class="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white rounded-lg font-bold shadow-sm transition">
            デモデータを削除 (${demoPreview.total}件)
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1 font-semibold text-amber-900">
          <div class="bg-white/80 p-2 rounded border border-amber-200">選考案件: ${demoPreview.selections} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">候補者: ${demoPreview.candidates} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">企業: ${demoPreview.companies} 件</div>
          <div class="bg-white/80 p-2 rounded border border-amber-200">求人: ${demoPreview.jobs} 件</div>
        </div>
      </div>

      <!-- 2. データ種別を選択して削除 (指示書 5-2項) -->
      <div class="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
        <div>
          <h4 class="font-bold text-slate-900 text-sm">📋 データ種別を指定して削除</h4>
          <p class="text-xs text-slate-500 mt-0.5">特定のデータ種別を選択して個別クリアできます。（削除時のデータ依存関係は自動で考慮されます）</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="selections" data-name="選考案件">
            <span>選考案件 (${allPreview.selections}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="candidates" data-name="候補者">
            <span>候補者 (${allPreview.candidates}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="companies" data-name="企業">
            <span>企業 (${allPreview.companies}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="jobs" data-name="求人">
            <span>求人 (${allPreview.jobs}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="histories" data-name="選考変更履歴">
            <span>選考変更履歴 (${allPreview.histories}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="communications" data-name="企業対応履歴">
            <span>企業対応履歴 (${allPreview.companyCommunications}件)</span>
          </label>
          <label class="inline-flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-slate-200 cursor-pointer font-bold hover:border-indigo-300">
            <input type="checkbox" class="chk-data-type rounded text-indigo-600" value="qTargets" data-name="Q目標">
            <span>個人Q目標 (${allPreview.qTargets}件)</span>
          </label>
        </div>

        <div class="flex justify-end pt-2">
          <button id="btn-delete-selected-data" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold transition">
            選択した種別のデータを削除
          </button>
        </div>
      </div>

      <!-- 3. 全業務データを初期化 (指示書 5-3, 9項) -->
      <div class="bg-rose-50/70 p-5 rounded-xl border border-rose-200 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 class="font-extrabold text-rose-950 text-sm flex items-center gap-2">
              <svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <span>全業務データを初期化 (本番データクリア)</span>
            </h4>
            <p class="text-xs text-slate-700 mt-1">
              候補者・企業・求人・選考案件・履歴などの全業務データ (${allPreview.total} 件) を削除して初期状態へ戻します。<br>
              <strong class="text-rose-900">※管理者・コンサルタントアカウントおよびログイン設定は削除されません。</strong>
            </p>
          </div>

          <div class="flex items-center space-x-2 shrink-0">
            <button id="btn-seed-demo-data" class="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-bold text-xs transition">
              デモデータを再作成
            </button>
            <button id="btn-open-reset-all-modal" ${allPreview.total === 0 ? 'disabled' : ''} class="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-lg font-extrabold shadow-sm transition">
              全業務データを初期化
            </button>
          </div>
        </div>
      </div>

      <!-- 4. 初期化履歴 (監査ログ: 指示書 17項) -->
      <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <h4 class="font-bold text-xs">📜 初期化・データ操作監査履歴 (過去100件)</h4>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th class="px-4 py-2.5">実行日時</th>
                <th class="px-4 py-2.5">操作種別</th>
                <th class="px-4 py-2.5">実行者</th>
                <th class="px-4 py-2.5">対象件数・詳細</th>
                <th class="px-3 py-2.5 text-center">結果</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${auditLogs.length === 0 ? `
                <tr><td colspan="5" class="text-center py-6 text-slate-400">操作履歴はありません。</td></tr>
              ` : auditLogs.map(log => {
                const opLabelMap = {
                  'DELETE_DEMO_DATA': 'デモデータ削除',
                  'DELETE_SELECTED_DATA': '選択データ削除',
                  'RESET_ALL_BUSINESS_DATA': '全業務データ初期化',
                  'CREATE_DEMO_DATA': 'デモデータ再作成'
                };
                const countsText = typeof log.targetCounts === 'object' ? JSON.stringify(log.targetCounts) : String(log.targetCounts);
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="px-4 py-2 font-mono text-slate-600">${new Date(log.executedAt).toLocaleString('ja-JP')}</td>
                    <td class="px-4 py-2 font-bold text-indigo-900">${opLabelMap[log.operationType] || log.operationType}</td>
                    <td class="px-4 py-2 font-semibold text-slate-800">${log.executedByName}</td>
                    <td class="px-4 py-2 font-mono text-slate-600 truncate max-w-xs" title="${countsText}">${countsText}</td>
                    <td class="px-3 py-2 text-center">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${log.result === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                        ${log.result}
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}


/**
 * 選考進捗・ヨミ管理システム - CSV一括取込モーダルコンポーネント
 */



function openCsvImportModal(onClose) {
  let modalEl = document.getElementById('csv-import-modal');
  if (modalEl) modalEl.remove();

  modalEl = document.createElement('div');
  modalEl.id = 'csv-import-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  let currentAnalysis = null;

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <h3 class="text-base font-bold flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          スプレッドシートデータ CSV一括取込
        </h3>
        <button id="btn-import-modal-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="p-6 overflow-y-auto space-y-5 flex-1">
        <!-- ステップ1: ファイル選択 -->
        <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3">
          <h4 class="font-bold text-slate-800">1. CSVファイルの選択</h4>
          <input type="file" id="input-csv-file" accept=".csv" class="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer">
          <p class="text-[11px] text-slate-500">取込推奨列: 候補者名, 企業名, 求人・ポジション, CA, RA, 選考フェーズ, 進行状態, 完了見込み月, ヨミ, 次回予定日, 備考</p>
        </div>

        <!-- オプション設定 -->
        <div class="flex items-center space-x-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <span class="font-bold text-slate-700">未存在マスタの取り扱い:</span>
          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="radio" name="auto-create" value="true" checked class="text-indigo-600">
            <span>新規マスタとして自動登録する</span>
          </label>
          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="radio" name="auto-create" value="false" class="text-indigo-600">
            <span>エラーとして取り込みを中止する</span>
          </label>
        </div>

        <!-- プレビュー表示エリア -->
        <div id="import-preview-area" class="hidden space-y-3">
          <div class="grid grid-cols-4 gap-3 text-center">
            <div class="bg-slate-100 p-3 rounded-lg border border-slate-200">
              <div class="text-slate-500 font-semibold">全検出件数</div>
              <div id="stat-total" class="text-lg font-black text-slate-800">0</div>
            </div>
            <div class="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
              <div class="text-emerald-800 font-semibold">新規登録件数</div>
              <div id="stat-new" class="text-lg font-black text-emerald-600">0</div>
            </div>
            <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <div class="text-blue-800 font-semibold">更新件数 (重複名寄せ)</div>
              <div id="stat-update" class="text-lg font-black text-blue-600">0</div>
            </div>
            <div class="bg-rose-50 p-3 rounded-lg border border-rose-200">
              <div class="text-rose-800 font-semibold">エラー件数</div>
              <div id="stat-error" class="text-lg font-black text-rose-600">0</div>
            </div>
          </div>

          <h5 class="font-bold text-slate-800">取込プレビュー一覧</h5>
          <div class="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
            <table class="w-full text-left text-[11px]">
              <thead class="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  <th class="px-2 py-1.5">行</th>
                  <th class="px-2 py-1.5">候補者名</th>
                  <th class="px-2 py-1.5">企業名</th>
                  <th class="px-2 py-1.5">求人名</th>
                  <th class="px-2 py-1.5">フェーズ</th>
                  <th class="px-2 py-1.5">ヨミ</th>
                  <th class="px-2 py-1.5">状態</th>
                </tr>
              </thead>
              <tbody id="table-preview-body" class="divide-y divide-slate-200"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <span class="text-slate-400">重複判定基準: 候補者＋企業＋求人</span>
        <div class="flex items-center space-x-3">
          <button type="button" id="btn-import-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold">
            キャンセル
          </button>
          <button type="button" id="btn-execute-import" disabled class="px-5 py-2 bg-indigo-600 text-white opacity-50 cursor-not-allowed rounded-lg text-xs font-bold shadow">
            一括取り込みを実行
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  let rawCsvText = '';

  modalEl.querySelector('#input-csv-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      rawCsvText = evt.target.result;
      runAnalysis();
    };
    reader.readAsText(file, 'UTF-8');
  });

  const runAnalysis = () => {
    if (!rawCsvText) return;
    const parsed = parseCSVText(rawCsvText);
    const autoCreate = modalEl.querySelector('input[name="auto-create"]:checked')?.value === 'true';

    currentAnalysis = analyzeImportCSV(parsed, autoCreate);

    if (currentAnalysis.error) {
      alert(currentAnalysis.error);
      return;
    }

    modalEl.querySelector('#import-preview-area').classList.remove('hidden');
    modalEl.querySelector('#stat-total').innerText = currentAnalysis.totalRows;
    modalEl.querySelector('#stat-new').innerText = currentAnalysis.newCount;
    modalEl.querySelector('#stat-update').innerText = currentAnalysis.updateCount;
    modalEl.querySelector('#stat-error').innerText = currentAnalysis.errorCount;

    const tbody = modalEl.querySelector('#table-preview-body');
    tbody.innerHTML = currentAnalysis.items.map(item => `
      <tr class="${item.hasError ? 'bg-rose-50' : item.isUpdate ? 'bg-blue-50/60' : ''}">
        <td class="px-2 py-1.5 font-bold">${item.lineNum}</td>
        <td class="px-2 py-1.5 font-bold">${item.candName}</td>
        <td class="px-2 py-1.5">${item.compName}</td>
        <td class="px-2 py-1.5">${item.jobTitle}</td>
        <td class="px-2 py-1.5 font-semibold text-indigo-700">${item.phase}</td>
        <td class="px-2 py-1.5 font-bold">${item.yomiVal * 100}%</td>
        <td class="px-2 py-1.5">
          ${item.hasError ? `<span class="text-rose-700 font-bold">${item.errors.join(', ')}</span>` : item.isUpdate ? '<span class="text-blue-700 font-bold">更新(名寄せ)</span>' : '<span class="text-emerald-700 font-bold">新規</span>'}
        </td>
      </tr>
    `).join('');

    const btnExec = modalEl.querySelector('#btn-execute-import');
    if (currentAnalysis.totalRows > 0 && currentAnalysis.errorCount === 0) {
      btnExec.disabled = false;
      btnExec.classList.remove('opacity-50', 'cursor-not-allowed');
      btnExec.classList.add('hover:bg-indigo-500');
    }
  };

  modalEl.querySelectorAll('input[name="auto-create"]').forEach(r => {
    r.addEventListener('change', runAnalysis);
  });

  modalEl.querySelector('#btn-execute-import')?.addEventListener('click', () => {
    if (!currentAnalysis) return;
    const count = executeImport(currentAnalysis.items, true);
    alert(`合計 ${count} 件の選考案件を取り込み・更新しました。`);
    modalEl.remove();
    if (onClose) onClose();
  });

  modalEl.querySelector('#btn-import-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-import-cancel')?.addEventListener('click', () => modalEl.remove());
}


/**
 * 選考進捗・ヨミ管理システム - 新規選考案件登録モーダル (エントリー経路 ＆ パスアップ詳細必須バリデーション対応)
 */





function openNewSelectionModal(onClose) {
  let modalEl = document.getElementById('new-selection-modal');
  if (modalEl) modalEl.remove();

  const candidates = store.getCandidates();
  const companies = store.getCompanies();
  const consultants = store.getConsultants();
  const caConsultants = store.getCaConsultants();
  const raConsultants = store.getRaConsultants();

  const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

  modalEl = document.createElement('div');
  modalEl.id = 'new-selection-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  const defaultMonth = new Date().toISOString().slice(0, 7);
  const defaultQInfo = getQuarterFromYearMonth(defaultMonth);

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <!-- モーダルヘッダー -->
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <h3 class="text-base font-bold flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          新規選考案件の登録 (管理単位: 候補者 × 企業 × 求人)
        </h3>
        <button id="btn-new-modal-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <!-- フォームボディ -->
      <div class="p-6 overflow-y-auto space-y-4 flex-1">
        <form id="form-new-selection" class="space-y-4" onsubmit="return false;">
          <!-- 1. 候補者入力 (オートコンプリートサジェスト付き) -->
          <div class="relative">
            <label class="block font-bold text-slate-800 mb-1">候補者 <span class="text-rose-500">*</span></label>
            <input
              type="text"
              id="new-candidate-name"
              maxlength="100"
              placeholder="候補者名を入力してください"
              autocomplete="off"
              required
              class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600 focus:bg-white"
            >
            <input type="hidden" id="selected-candidate-id" value="">

            <!-- 候補サジェストドロップダウン -->
            <div id="candidate-suggest-dropdown" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-slate-100 text-xs"></div>
          </div>

          <!-- 2. 企業 & 求人 連動選択 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">企業 <span class="text-rose-500">*</span></label>
              <select id="new-company-id" required class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600">
                <option value="">-- 企業を選択してください --</option>
                ${companies.map(c => `<option value="${c.companyId}">${c.name} (${c.rank})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">求人・ポジション <span class="text-rose-500">*</span></label>
              <select id="new-job-id" required disabled class="w-full bg-slate-100 border border-slate-300 rounded px-3 py-2 font-medium text-slate-800 focus:outline-none focus:border-indigo-600">
                <option value="">-- 企業を選択すると求人が表示されます --</option>
              </select>
            </div>
          </div>

          <!-- 3. エントリー経路 ＆ パスアップ詳細 (指示書 8, 9, 11, 14項) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
            <div>
              <label class="block font-bold text-slate-800 mb-1">エントリー経路 <span class="text-rose-500">*</span></label>
              <select id="new-entry-source" class="w-full bg-white border border-slate-300 font-bold text-indigo-900 rounded px-3 py-2 focus:outline-none focus:border-indigo-600">
                <option value="UNSET">-- 選択してください --</option>
                ${ENTRY_SOURCES.map(s => `<option value="${s.code}">${s.label}</option>`).join('')}
              </select>
            </div>

            <div id="container-entry-detail" class="hidden">
              <label id="label-entry-detail" class="block font-bold text-slate-800 mb-1">パスアップ詳細 <span class="text-rose-500">*</span></label>
              <input type="text" id="new-entry-detail" placeholder="例: 若山さんスカウト" class="w-full bg-white border border-slate-300 rounded px-3 py-2 font-bold text-slate-800 focus:outline-none focus:border-indigo-600">
            </div>
          </div>

          <!-- 4. CA / RA 担当コンサル設定 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">CA担当 (キャリアアドバイザー)</label>
              <select id="new-ca-id" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none font-semibold text-slate-800">
                ${caConsultants.map(c => `<option value="${c.consultantId}">${c.name} (CA)</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">RA担当 (リクルーティングアドバイザー)</label>
              <select id="new-ra-id" class="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 focus:outline-none font-semibold text-slate-800">
                ${raConsultants.map(c => `<option value="${c.consultantId}">${c.name} (RA)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 5. フェーズ・進行状態・ヨミ -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200 pt-4">
            <div>
              <label class="block font-bold text-slate-800 mb-1">選考フェーズ</label>
              <select id="new-phase" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2.5 py-1.5 font-bold focus:outline-none">
                ${PHASES.map(p => `<option value="${p}">${p}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">進行状態</label>
              <select id="new-status" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
                ${PROGRESS_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-800 mb-1">ヨミ (内定承諾見込み)</label>
              <select id="new-yomi" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2.5 py-1.5 font-bold focus:outline-none">
                ${YOMI_OPTIONS.map(y => `<option value="${y.value}" ${y.value === 0.25 ? 'selected' : ''}>${y.label} (${y.value * 100}%)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 6. 推薦日・予定日 ＆ 完了見込み月 -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">推薦日</label>
              <input type="date" id="new-recommendation-date" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">次回予定日</label>
              <input type="date" id="new-next-date" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none">
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="font-bold text-slate-800">完了見込み月</label>
                <span id="badge-q-forecast" class="text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">
                  ${defaultQInfo ? `着地見込みQ：${defaultQInfo.label}` : '着地見込みQ：未設定'}
                </span>
              </div>
              <input type="month" id="new-expected-completion-month" value="${defaultMonth}" class="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1">社内メモ (他社状況・評価)</label>
            <textarea id="new-internal-memo" rows="2" placeholder="推薦時の所感・注意点など" class="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none"></textarea>
          </div>
        </form>
      </div>

      <!-- モーダルフッター -->
      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
        <button type="button" id="btn-new-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition">
          キャンセル
        </button>
        <button type="button" id="btn-new-submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs shadow transition">
          登録する
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const candNameInput = modalEl.querySelector('#new-candidate-name');
  const candIdHidden = modalEl.querySelector('#selected-candidate-id');
  const suggestDropdown = modalEl.querySelector('#candidate-suggest-dropdown');
  const companySelect = modalEl.querySelector('#new-company-id');
  const jobSelect = modalEl.querySelector('#new-job-id');
  const entrySourceSelect = modalEl.querySelector('#new-entry-source');
  const entryDetailContainer = modalEl.querySelector('#container-entry-detail');
  const entryDetailLabel = modalEl.querySelector('#label-entry-detail');
  const entryDetailInput = modalEl.querySelector('#new-entry-detail');
  const caSelect = modalEl.querySelector('#new-ca-id');
  const raSelect = modalEl.querySelector('#new-ra-id');
  const phaseSelect = modalEl.querySelector('#new-phase');
  const yomiSelect = modalEl.querySelector('#new-yomi');
  const completionMonthInput = modalEl.querySelector('#new-expected-completion-month');
  const qBadge = modalEl.querySelector('#badge-q-forecast');

  // エントリー経路の動的制御 (指示書 9項)
  entrySourceSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'PASS_UP') {
      entryDetailLabel.innerHTML = 'パスアップ詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = '例: 若山さんスカウト、自動スカウト';
      entryDetailContainer.classList.remove('hidden');
    } else if (val === 'OTHER') {
      entryDetailLabel.innerHTML = '経路詳細 <span class="text-rose-500">*</span>';
      entryDetailInput.placeholder = 'エントリー経路の詳細を入力してください';
      entryDetailContainer.classList.remove('hidden');
    } else {
      entryDetailContainer.classList.add('hidden');
      entryDetailInput.value = '';
    }
  });

  completionMonthInput?.addEventListener('change', (e) => {
    const val = e.target.value;
    const qInfo = getQuarterFromYearMonth(val);
    if (qInfo) {
      qBadge.textContent = `着地見込みQ：${qInfo.label}`;
      qBadge.className = 'text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200';
    } else {
      qBadge.textContent = '着地見込みQ：未設定';
      qBadge.className = 'text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-200';
    }
  });

  function hideSuggest() {
    suggestDropdown.classList.add('hidden');
    suggestDropdown.innerHTML = '';
  }

  function renderSuggestList(kw) {
    const trimmed = kw.trim().toLowerCase();
    if (!trimmed) {
      hideSuggest();
      return;
    }

    const allCands = store.getCandidates();
    const matched = allCands.filter(c => {
      if (c.isArchived) return false;
      const name = (c.name || '').toLowerCase();
      const kana = (c.kana || '').toLowerCase();
      return name.includes(trimmed) || kana.includes(trimmed);
    });

    let html = '';

    if (matched.length > 0) {
      html += matched.map(c => {
        const ca = consultantsMap.get(c.caId || c.caConsultantId);
        return `
          <div class="suggest-item p-2.5 hover:bg-indigo-50 cursor-pointer flex items-center justify-between transition" data-id="${c.candidateId}" data-name="${c.name}" data-ca-id="${c.caId || c.caConsultantId}">
            <div>
              <span class="font-bold text-slate-900">${c.name} 様</span>
              <span class="text-[10px] text-slate-400 block">${c.kana || ''}</span>
            </div>
            <span class="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-medium">担当CA: ${ca ? ca.name : '未設定'}</span>
          </div>
        `;
      }).join('');
    }

    html += `
      <div class="suggest-item-new p-2.5 hover:bg-slate-100 cursor-pointer font-bold text-indigo-600 flex items-center justify-between bg-slate-50 transition" data-name="${kw.trim()}">
        <span>＋「${kw.trim()}」を新しい候補者として登録</span>
        <span class="text-[10px] text-slate-400">（新規マスタ自動作成）</span>
      </div>
    `;

    suggestDropdown.innerHTML = html;
    suggestDropdown.classList.remove('hidden');

    suggestDropdown.querySelectorAll('.suggest-item').forEach(item => {
      item.addEventListener('click', () => {
        const cId = item.getAttribute('data-id');
        const cName = item.getAttribute('data-name');
        const caId = item.getAttribute('data-ca-id');

        candNameInput.value = cName;
        candIdHidden.value = cId;
        if (caId && caSelect.querySelector(`option[value="${caId}"]`)) {
          caSelect.value = caId;
        }
        hideSuggest();
      });
    });

    suggestDropdown.querySelectorAll('.suggest-item-new').forEach(item => {
      item.addEventListener('click', () => {
        const newName = item.getAttribute('data-name');
        candNameInput.value = newName;
        candIdHidden.value = '';
        hideSuggest();
      });
    });
  }

  candNameInput.addEventListener('input', (e) => {
    candIdHidden.value = '';
    renderSuggestList(e.target.value);
  });

  candNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      hideSuggest();
    }
  });

  document.addEventListener('click', (e) => {
    if (!modalEl.contains(e.target)) return;
    if (!candNameInput.contains(e.target) && !suggestDropdown.contains(e.target)) {
      hideSuggest();
    }
  });

  companySelect?.addEventListener('change', (e) => {
    const compId = e.target.value;
    if (!compId) {
      jobSelect.disabled = true;
      jobSelect.innerHTML = '<option value="">-- 企業を選択してください --</option>';
      return;
    }

    const companyJobs = store.getJobs(false, compId);
    jobSelect.disabled = false;
    jobSelect.innerHTML = companyJobs.length === 0
      ? '<option value="">-- 登録求人がありません --</option>'
      : companyJobs.map(j => `<option value="${j.jobId}">${j.title || j.jobName} (${j.status || '募集中'})</option>`).join('');

    const comp = store.getCompanies().find(c => c.companyId === compId);
    if (comp && (comp.primaryRaId || comp.raConsultantId)) {
      const raId = comp.primaryRaId || comp.raConsultantId;
      if (raSelect.querySelector(`option[value="${raId}"]`)) {
        raSelect.value = raId;
      }
    }
  });

  phaseSelect?.addEventListener('change', (e) => {
    const suggested = INITIAL_YOMI_MAP[e.target.value];
    if (suggested !== undefined) {
      yomiSelect.value = String(suggested);
    }
  });

  function proceedRegistration(finalCandId, finalCandName) {
    const companyId = companySelect.value;
    const jobId = jobSelect.value;
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();

    const existingSel = store.getSelections().find(s => 
      s.candidateId === finalCandId && s.companyId === companyId && s.jobId === jobId
    );

    if (existingSel) {
      if (!confirm('同じ【候補者×企業×求人】の選考案件が既に登録されています。重複して登録しますか？')) {
        return;
      }
    }

    store.addSelection({
      candidateId: finalCandId,
      candidateName: finalCandName,
      companyId,
      jobId,
      caConsultantId: caSelect.value,
      caId: caSelect.value,
      raConsultantId: raSelect.value,
      raId: raSelect.value,
      entrySource,
      entrySourceDetail: entryDetail,
      phase: phaseSelect.value,
      progressStatus: modalEl.querySelector('#new-status').value,
      yomi: Number(yomiSelect.value),
      recommendationDate: modalEl.querySelector('#new-recommendation-date').value,
      nextScheduleDate: modalEl.querySelector('#new-next-date').value || null,
      expectedCompletionMonth: completionMonthInput.value || null,
      internalMemo: modalEl.querySelector('#new-internal-memo').value
    });

    modalEl.remove();
    if (onClose) onClose();
  }

  modalEl.querySelector('#btn-new-submit')?.addEventListener('click', () => {
    const rawCandName = candNameInput.value.trim();
    const selectedCandId = candIdHidden.value;
    const companyId = companySelect.value;
    const jobId = jobSelect.value;
    const entrySource = entrySourceSelect.value;
    const entryDetail = entryDetailInput.value.trim();

    if (!rawCandName) {
      alert('候補者名を入力してください。');
      candNameInput.focus();
      return;
    }

    if (!companyId || !jobId) {
      alert('企業および求人は必須選択項目です。');
      return;
    }

    // エントリー経路の必須・手入力バリデーション (指示書 9-2, 9-3項)
    if (entrySource === 'PASS_UP' && !entryDetail) {
      alert('パスアップの詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }
    if (entrySource === 'OTHER' && !entryDetail) {
      alert('経路詳細を入力してください。');
      entryDetailInput.focus();
      return;
    }

    const selectedCaId = caSelect.value;

    if (selectedCandId) {
      const existingCand = store.getCandidates().find(c => c.candidateId === selectedCandId);
      proceedRegistration(selectedCandId, existingCand ? existingCand.name : rawCandName);
      return;
    }

    const normalizedNew = rawCandName.replace(/\s+/g, '').toLowerCase();
    const similarCands = store.getCandidates().filter(c => {
      if (c.isArchived) return false;
      const normalizedExisting = (c.name || '').replace(/\s+/g, '').toLowerCase();
      return normalizedExisting === normalizedNew || normalizedExisting.includes(normalizedNew) || normalizedNew.includes(normalizedExisting);
    });

    if (similarCands.length > 0) {
      showSimilarWarningModal(rawCandName, similarCands, (actionChoice, chosenCand) => {
        if (actionChoice === 'use_existing') {
          proceedRegistration(chosenCand.candidateId, chosenCand.name);
        } else if (actionChoice === 'create_new') {
          const newCand = createNewCandidateMaster(rawCandName, selectedCaId);
          proceedRegistration(newCand.candidateId, newCand.name);
        }
      });
      return;
    }

    const newCand = createNewCandidateMaster(rawCandName, selectedCaId);
    proceedRegistration(newCand.candidateId, newCand.name);
  });

  function createNewCandidateMaster(name, caId) {
    const caCons = consultantsMap.get(caId);
    const newCand = {
      name: name,
      kana: name,
      caId: caId,
      caName: caCons ? caCons.name : '未設定',
      caConsultantId: caId,
      activityStatus: '選考中',
      internalManagementNumber: 'CD-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900),
      remarks: '選考案件登録時に自動作成された候補者'
    };
    store.saveCandidate(newCand);
    return store.getCandidates().find(c => c.name === name) || newCand;
  }

  modalEl.querySelector('#btn-new-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-new-cancel')?.addEventListener('click', () => modalEl.remove());
}

function showSimilarWarningModal(inputName, similarCands, callback) {
  let warnEl = document.getElementById('similar-warning-modal');
  if (warnEl) warnEl.remove();

  warnEl = document.createElement('div');
  warnEl.id = 'similar-warning-modal';
  warnEl.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4';

  warnEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-amber-200 w-full max-w-md p-6 space-y-4 animate-fadeIn text-xs">
      <div class="flex items-center space-x-3 text-amber-600 border-b border-amber-100 pb-3">
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h4 class="font-bold text-sm text-slate-800">同名または類似する候補者の検出</h4>
      </div>

      <p class="text-slate-600 font-medium">
        入力した候補者名 <strong>「${inputName}」</strong> と同名、または非常に類似する候補者が既に登録されています。
      </p>

      <div class="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2 max-h-36 overflow-y-auto">
        <span class="font-bold text-amber-900 block text-[11px]">検出された既存候補者:</span>
        ${similarCands.map(c => `
          <label class="flex items-center justify-between bg-white p-2 rounded border border-amber-200 cursor-pointer hover:bg-amber-100/50">
            <div class="flex items-center space-x-2">
              <input type="radio" name="chosen-similar-cand" value="${c.candidateId}" checked class="text-indigo-600">
              <span class="font-bold text-slate-800">${c.name} 様</span>
            </div>
            <span class="text-[10px] text-slate-500">担当CA: ${c.caName || '-'}</span>
          </label>
        `).join('')}
      </div>

      <div class="space-y-2 pt-2 border-t border-slate-200">
        <button id="btn-warn-use-existing" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow transition">
          選択した既存候補者を使用する
        </button>
        <button id="btn-warn-create-new" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition">
          「${inputName}」を別の候補者として新規登録する
        </button>
        <button id="btn-warn-cancel" class="w-full py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-semibold">
          入力へ戻る
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(warnEl);

  warnEl.querySelector('#btn-warn-use-existing')?.addEventListener('click', () => {
    const selectedId = warnEl.querySelector('input[name="chosen-similar-cand"]:checked')?.value;
    const chosen = similarCands.find(c => c.candidateId === selectedId) || similarCands[0];
    warnEl.remove();
    callback('use_existing', chosen);
  });

  warnEl.querySelector('#btn-warn-create-new')?.addEventListener('click', () => {
    warnEl.remove();
    callback('create_new', null);
  });

  warnEl.querySelector('#btn-warn-cancel')?.addEventListener('click', () => {
    warnEl.remove();
    callback('cancel', null);
  });
}




/**
 * 指示書 1, 3, 4項: 共通データ不一致の強制切り分けテスト専用画面 (/sync-diagnostic)
 * ※ localStorage, sessionStorage, IndexedDB, デモデータ, 既存 state を完全遮断
 */
async function renderSyncDiagnosticView(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto p-6 space-y-6">
      <!-- ヘッダー -->
      <div class="bg-slate-900 text-white p-6 rounded-xl shadow-2xl border border-blue-500/30 flex justify-between items-center">
        <div>
          <div class="inline-flex items-center space-x-2 bg-blue-500/20 text-blue-400 font-mono text-xs px-3 py-1 rounded-full border border-blue-500/30 mb-2">
            <span>🧪 FORCED ISOLATION DIAGNOSTIC</span>
          </div>
          <h1 class="text-2xl font-black tracking-tight text-slate-100">SYNC DIAGNOSTIC</h1>
          <p class="text-xs text-slate-400 mt-1">Firestore サーバーから固定ドキュメント (syncDiagnostics/shared-test) を直接強制読み込み</p>
        </div>
        <button id="btn-reload-diagnostic" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-all shadow-md flex items-center space-x-2">
          <span>🔄 サーバーから再取得</span>
        </button>
      </div>

      <!-- 診断結果表示カード -->
      <div id="diagnostic-result-container" class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm min-h-[300px]">
        <div class="flex items-center justify-center min-h-[240px] space-x-3 text-slate-500">
          <div class="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span class="font-bold text-sm">Firestore サーバーから直接取得中...</span>
        </div>
      </div>
    </div>
  `;

  const reloadBtn = container.querySelector('#btn-reload-diagnostic');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => renderSyncDiagnosticView(container));
  }

  const resultContainer = container.querySelector('#diagnostic-result-container');

  // 指示書 1項: 他のキャッシュや state を介さず、サーバーから直接フェッチ
  const res = await fetchSyncDiagnosticFromServer();

  if (res.success) {
    resultContainer.innerHTML = `
      <div class="space-y-4 font-mono text-sm">
        <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 font-bold text-base flex justify-between items-center">
          <div class="flex items-center space-x-2">
            <span class="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></span>
            <span>FIRESTORE DIRECT READ SUCCESS</span>
          </div>
          <span class="text-xs bg-emerald-200 text-emerald-800 px-2.5 py-1 rounded-full font-sans">Loaded from: ${res.loadedFrom}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div>
            <span class="text-xs text-slate-500 font-sans block">Project ID</span>
            <span class="font-bold text-slate-800 text-base">${res.projectId}</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 font-sans block">Database ID</span>
            <span class="font-bold text-slate-800 text-base">${res.databaseId}</span>
          </div>
          <div class="md:col-span-2">
            <span class="text-xs text-slate-500 font-sans block">Document path</span>
            <span class="font-bold text-blue-600 text-base bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">${res.documentPath}</span>
          </div>
        </div>

        <div class="bg-slate-900 text-slate-100 p-5 rounded-xl space-y-3 shadow-inner">
          <div class="grid grid-cols-2 gap-4 border-b border-slate-800 pb-3">
            <div>
              <span class="text-xs text-slate-400 font-sans block">Exists</span>
              <span class="font-bold text-emerald-400 text-base">${res.exists ? 'true' : 'false'}</span>
            </div>
            <div>
              <span class="text-xs text-slate-400 font-sans block">Test number</span>
              <span class="font-bold text-amber-400 text-base">${res.testNumber}</span>
            </div>
          </div>

          <div class="py-1">
            <span class="text-xs text-slate-400 font-sans block">Message</span>
            <span class="font-black text-white text-lg tracking-wide bg-slate-800 px-3 py-1 rounded inline-block mt-1 border border-slate-700">${res.message}</span>
          </div>

          <div class="grid grid-cols-2 gap-4 border-t border-slate-800 pt-3 text-xs">
            <div>
              <span class="text-slate-400 font-sans block">Updated by</span>
              <span class="text-slate-200 font-semibold">${res.updatedBy}</span>
            </div>
            <div>
              <span class="text-slate-400 font-sans block">Updated at</span>
              <span class="text-slate-200 font-semibold">${res.updatedAt}</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 text-xs font-sans text-slate-600 bg-white p-3 rounded border border-slate-200">
          <div>
            <span class="font-bold text-slate-700">Loaded at:</span> ${res.loadedAt}
          </div>
          <div>
            <span class="font-bold text-slate-700">Auth UID:</span> <code class="bg-slate-100 px-1 py-0.5 rounded">${res.authUid}</code>
          </div>
        </div>
      </div>
    `;
  } else {
    // 指示書 3項: エラー発生時はエラーコード・メッセージを画面上に明示表示
    resultContainer.innerHTML = `
      <div class="p-5 bg-rose-50 border-2 border-rose-300 rounded-xl space-y-4 font-mono">
        <div class="flex items-center space-x-2 text-rose-800 font-bold text-base">
          <span>❌ FIRESTORE DIRECT READ FAILED</span>
        </div>

        <div class="bg-white p-4 rounded-lg border border-rose-200 space-y-2 text-sm">
          <div>
            <span class="text-xs text-slate-500 font-sans block">Error code</span>
            <span class="font-bold text-rose-600">${res.error?.code || 'UNKNOWN'}</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 font-sans block">Error message</span>
            <p class="text-xs text-slate-800 bg-slate-50 p-2 rounded border border-slate-200 font-mono mt-1">${res.error?.message || 'Failed to read document'}</p>
          </div>
        </div>

        <div class="text-xs text-slate-600 font-sans">
          ※ 認証・権限、Vercel環境変数、またはネットワーク接続をご確認ください。
        </div>
      </div>
    `;
  }
}


/**
 * 選考進捗・ヨミ管理システム - メインアプリケーションエントリーポイント (CA/RA・企業対応拡張版)
 */





















class App {
  constructor() {
    this.currentView = (window.location.hash === '#sync-diagnostic') ? 'syncDiagnostic' : VIEWS.COMPANY_ACTIONS;
    this.viewFilters = {};
    this.directFetchResult = null;
    this.init();
  }

  init() {
    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#sync-diagnostic') {
        this.currentView = 'syncDiagnostic';
        this.render();
      }
    });

    store.subscribe(() => {
      this.render();
    });

    this.render();
  }

  render() {
    const headerContainer = document.getElementById('app-header');
    const sidebarContainer = document.getElementById('app-sidebar');
    const contentContainer = document.getElementById('app-content');

    if (!headerContainer || !sidebarContainer || !contentContainer) return;

    // 指示書 9項: Firestore 共通データ読み込み中のローディング表示
    if (store.isLoading) {
      contentContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
          <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-slate-800 font-extrabold text-base">共通データを読み込んでいます</p>
          <p class="text-xs text-slate-500">Firestore から最新のデータを同期中です...</p>
        </div>
      `;
      return;
    }

    // 端末B リアルタイム診断パネルの描画 (指示書 1, 6項)
    this.renderTerminalBDebugPanel();

    // ヘッダー描画
    renderHeader(headerContainer, {
      activeViewTitle: this.getViewTitle(this.currentView),
      onOpenNewSelection: () => openNewSelectionModal(() => this.render()),
      onOpenCsvImport: () => openCsvImportModal(() => this.render())
    });

    // サイドバー描画
    renderSidebar(sidebarContainer, this.currentView, (viewId) => {
      this.currentView = viewId;
      this.viewFilters = {};
      this.render();
    });

    // メインコンテンツ描画
    contentContainer.innerHTML = '';
    const viewContainer = document.createElement('div');
    contentContainer.appendChild(viewContainer);

    switch (this.currentView) {
      case 'syncDiagnostic':
        renderSyncDiagnosticView(viewContainer);
        break;

      // 旧ビューおよび全体ダッシュボードからの統一リダイレクト（企業対応へ一本化）
      case VIEWS.DASHBOARD:
      case VIEWS.SELECTIONS:
      case VIEWS.CA:
      case VIEWS.RA:
      case VIEWS.CONSULTANTS:
        renderCompanyActionListView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onOpenEmailComposer: (companyId, selectionIds = null) => {
            openEmailComposerModal(companyId, selectionIds);
          }
        });
        break;

      case VIEWS.KANBAN:
        renderWhiteboardV2(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onNavigateToCompanyActions: (filterUrgencyCode) => {
            this.currentView = VIEWS.COMPANY_ACTIONS;
            this.viewFilters = { filterUrgencyCode };
            this.render();
          }
        });
        break;

      case VIEWS.RA:
        renderCompanyActionListView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          },
          onOpenEmailComposer: (companyId, selectionIds = null) => {
            openEmailComposerModal(companyId, () => this.render(), selectionIds);
          }
        });
        break;

      case VIEWS.COMPANIES:
        renderCompanyView(contentContainer, this.viewFilters.companyId || '', {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.JOBS:
        renderJobView(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;

      case VIEWS.MASTERS:
        renderMasterManagement(contentContainer);
        break;

      default:
        renderDashboard(contentContainer, {
          onOpenDetail: (selectionId) => {
            openSelectionDetailModal(selectionId, () => this.render());
          }
        });
        break;
    }
  }

  getViewTitle(viewId) {
    switch (viewId) {
      case VIEWS.DASHBOARD: return '全体ダッシュボード';
      case VIEWS.SELECTIONS: return '選考一覧';
      case VIEWS.KANBAN: return 'ホワイトボード';
      case VIEWS.CA: return 'CA管理画面';
      case VIEWS.RA: return 'RA管理画面';
      case VIEWS.COMPANY_ACTIONS: return '企業対応';
      case VIEWS.CONSULTANTS: return 'コンサル別実績';
      case VIEWS.COMPANIES: return '企業別・提出エクスポート';
      case VIEWS.JOBS: return '求人・ポジション別';
      case VIEWS.MASTERS: return 'マスタ管理';
      default: return '選考進捗・ヨミ管理システム';
    }
  }

  renderTerminalBDebugPanel() {
    // 利用者画面へのデバッグパネルUI描画は完全に無効化（Firestore通信・ログ記録・リアルタイム処理は維持）
    return;
  }

  renderDebugPanel(rawCount = 0) {
    // 利用者画面へのデバッグパネルUI描画は完全に無効化
    return;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});


