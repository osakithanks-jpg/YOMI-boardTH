/**
 * 選考進捗・ヨミ管理システム - メインアプリケーションエントリーポイント (CA/RA・企業対応拡張版)
 */

import { store } from './store.js';
import { renderHeader } from './components/header.js';
import { renderSidebar, VIEWS } from './components/sidebar.js';
import { renderDashboard } from './components/dashboardView.js';
import { renderSelectionList } from './components/selectionListView.js';
import { openSelectionDetailModal } from './components/selectionDetailModal.js';
import { renderWhiteboardV2 } from './components/whiteboardV2.js';
import { renderCaView } from './components/caView.js';
import { renderRaView } from './components/raView.js';
import { renderCompanyActionListView } from './components/companyActionListView.js';
import { renderConsultantView } from './components/consultantView.js';
import { renderCompanyView } from './components/companyView.js';
import { renderJobView } from './components/jobView.js';
import { renderMasterManagement } from './components/masterManagementView.js';
import { openNewSelectionModal } from './components/newSelectionModal.js';
import { openCsvImportModal } from './components/csvImportModal.js';
import { openEmailComposerModal } from './components/emailComposerModal.js';
import { renderSyncDiagnosticView } from './components/syncDiagnosticView.js';
import { fetchSelectionsFromServerDirect, migrateLocalDataToFirestore, seedAllInitialDataToFirestore } from './firebase.js';

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
