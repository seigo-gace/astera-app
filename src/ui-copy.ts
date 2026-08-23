import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export const UI_COPY = {
  ja: {
    headerPage: 'ページ', headerEvidence: '根拠', headerToggleAria: 'ページと根拠の切替', organizeResultAria: 'Resultを整理', organizeResultTitle: '整理',
    resultDescription: '固定8項目Result、Source、Revision、編集、Download、Share、Project移動、Delete/Undoを管理します。',
    resultRevisionSaved: '新しいRevisionとして保存しました。', resultMovedProject: 'ResultをProjectへ移動しました。', resultMovedUnassigned: 'ResultをUnassignedへ移動しました。',
    resultDeleteConfirm: 'Resultを削除予定状態にします。共有は失効し、取消期限内ならUndoできます。', resultDeleteScheduled: 'Resultを削除予定にしました。', resultDeleteUndone: 'Result削除を取り消しました。',
    resultExportFailed: 'Exportに失敗しました。', resultCopiedAll: '8項目をClipboardへコピーしました。', resultClipboardFailed: 'Clipboardへコピーできませんでした。',
    resultCopyAll: '全体をCopy', resultMoreAria: 'その他の操作', resultDelete: '削除', resultUndoDelete: '削除をUndo', resultDeletedPending: 'Deleted Pending', resultUndoUntil: 'Undo期限', resultUndoAction: '削除を取り消す',
    resultSchemaWarning: '固定8項目Schemaを確認できません。編集や完成扱いを停止してください。', resultRevision: 'Revision', resultRevisionEmpty: 'Revision情報がありません。', resultRevisionDisplay: '表示Revision',
    resultProject: 'Project', resultProjectMembership: '所属Project', resultCopy: 'Copy', resultSaveNewRevision: '新Revisionで保存', resultCancel: 'Cancel', resultEdit: 'Edit',
    resultSourceTitle: 'Source / 根拠', resultSourceModeAria: 'Source表示方式', resultSourceNumber: '番号', resultSourceDetail: '詳細', resultSourceEmpty: 'Sourceはありません。', resultSourceUnverified: 'unverified', resultSourceUnknownTime: '取得時刻不明',
    historyDescription: 'Normal Modeで保存されたHistoryを検索・絞込みし、Revision付きResultへ移動します。Private Modeの実行はHistoryへ保存しません。',
    historyAllPurpose: 'すべてのPurpose', historyPurposeAuto: '自動', historyPurposeReview: 'レビュー', historyPurposeCompare: '比較', historyPurposeVerify: '検証', historyPurposeImprove: '改善', historyPurposeResearch: '調査', historyPurposePlan: '計画', historyPurposeConsider: '検討',
    historyAllProjects: 'すべてのProject', historyArchivedSuffix: '（Archived）', historyFilter: 'History Filter', historySearch: '検索', historySearchPlaceholder: 'Title・本文・Purpose', historyState: '状態', historyAllStates: 'すべての状態', historyFrom: '開始日', historyTo: '終了日', historyApply: '適用', historyClear: 'Clear', historyTitle: 'History', historyNoMatch: '条件に一致するHistoryはありません。', historyEmpty: '保存済みHistoryはありません。', historyPaginationAria: 'History pagination', historyPrevious: '前へ', historyNext: '次へ', historyPageSuffix: 'Page',
    projectDescription: '単階層Projectを作成・検索・Rename・Archiveし、ResultをProjectまたはUnassignedへ整理します。', projectCreated: 'Projectを作成しました。', projectDeleteConfirm: 'Projectを削除します。Project内のResultは削除せずUnassignedへ戻します。', projectDeleted: 'Projectを削除し、ResultをUnassignedへ戻しました。', projectMovedResult: 'ResultをProjectへ移動しました。', projectMovedResultUnassigned: 'ResultをUnassignedへ移動しました。', projectCreatedPanel: '新規Project', projectName: 'Project名', projectOptionalDescription: '説明（任意）', projectCreate: '作成', projectSearchPanel: 'Projectを探す', projectSearch: '検索', projectSearchPlaceholder: 'Project名・説明', projectStateAria: 'Project状態', projectActive: 'Active Project', projectArchived: 'Archived Project', projectNoMatch: '条件に一致するProjectはありません。', projectEmpty: 'Projectはありません。', projectNoDescription: '説明なし', projectCloseDetailAria: 'Project詳細を閉じる', projectDetail: 'Project詳細', projectClose: '閉じる', projectSelect: 'Projectを選択してください。', projectDescriptionLabel: '説明', projectUpdated: 'Project情報を更新しました。', projectSave: '保存', projectArchivedSuccess: 'ProjectをArchiveしました。', projectActivatedSuccess: 'ProjectをActiveへ戻しました。', projectRestoreActive: 'Activeへ戻す', projectDelete: '削除', projectResultEmpty: 'このProjectにResultはありません。', projectMoveTo: '移動先', projectCurrentArchived: '現在のArchived Project',
  },
  en: {
    headerPage: 'Page', headerEvidence: 'Evidence', headerToggleAria: 'Switch between page and evidence', organizeResultAria: 'Organize result', organizeResultTitle: 'Organize',
    resultDescription: 'Manage the fixed eight-part result, sources, revisions, editing, downloads, sharing, project moves, and delete/undo.',
    resultRevisionSaved: 'Saved as a new revision.', resultMovedProject: 'Moved the result to the project.', resultMovedUnassigned: 'Moved the result to Unassigned.',
    resultDeleteConfirm: 'Schedule this result for deletion. Shares will expire and it can be undone before the deadline.', resultDeleteScheduled: 'Result scheduled for deletion.', resultDeleteUndone: 'Result deletion was undone.',
    resultExportFailed: 'Export failed.', resultCopiedAll: 'Copied all eight sections to the clipboard.', resultClipboardFailed: 'Could not write to the clipboard.',
    resultCopyAll: 'Copy all', resultMoreAria: 'More actions', resultDelete: 'Delete', resultUndoDelete: 'Undo delete', resultDeletedPending: 'Deleted Pending', resultUndoUntil: 'Undo until', resultUndoAction: 'Undo deletion',
    resultSchemaWarning: 'The fixed eight-part schema could not be confirmed. Stop editing and completion handling.', resultRevision: 'Revision', resultRevisionEmpty: 'No revision information.', resultRevisionDisplay: 'Displayed revision',
    resultProject: 'Project', resultProjectMembership: 'Project', resultCopy: 'Copy', resultSaveNewRevision: 'Save as new revision', resultCancel: 'Cancel', resultEdit: 'Edit',
    resultSourceTitle: 'Source / Evidence', resultSourceModeAria: 'Source display mode', resultSourceNumber: 'Number', resultSourceDetail: 'Detail', resultSourceEmpty: 'No sources.', resultSourceUnverified: 'unverified', resultSourceUnknownTime: 'retrieval time unknown',
    historyDescription: 'Search and filter history saved in Normal Mode and open revisioned results. Private Mode runs are not saved to history.',
    historyAllPurpose: 'All purposes', historyPurposeAuto: 'Auto', historyPurposeReview: 'Review', historyPurposeCompare: 'Compare', historyPurposeVerify: 'Verify', historyPurposeImprove: 'Improve', historyPurposeResearch: 'Research', historyPurposePlan: 'Plan', historyPurposeConsider: 'Consider',
    historyAllProjects: 'All projects', historyArchivedSuffix: ' (Archived)', historyFilter: 'History Filter', historySearch: 'Search', historySearchPlaceholder: 'Title, body, or purpose', historyState: 'Status', historyAllStates: 'All statuses', historyFrom: 'From', historyTo: 'To', historyApply: 'Apply', historyClear: 'Clear', historyTitle: 'History', historyNoMatch: 'No history matches these conditions.', historyEmpty: 'No saved history.', historyPaginationAria: 'History pagination', historyPrevious: 'Previous', historyNext: 'Next', historyPageSuffix: 'Page',
    projectDescription: 'Create, search, rename, and archive single-level projects and organize results into a project or Unassigned.', projectCreated: 'Project created.', projectDeleteConfirm: 'Delete this project? Results inside it will not be deleted and will return to Unassigned.', projectDeleted: 'Project deleted and results returned to Unassigned.', projectMovedResult: 'Moved the result to the project.', projectMovedResultUnassigned: 'Moved the result to Unassigned.', projectCreatedPanel: 'New project', projectName: 'Project name', projectOptionalDescription: 'Description (optional)', projectCreate: 'Create', projectSearchPanel: 'Find projects', projectSearch: 'Search', projectSearchPlaceholder: 'Project name or description', projectStateAria: 'Project status', projectActive: 'Active Project', projectArchived: 'Archived Project', projectNoMatch: 'No projects match these conditions.', projectEmpty: 'No projects.', projectNoDescription: 'No description', projectCloseDetailAria: 'Close project details', projectDetail: 'Project details', projectClose: 'Close', projectSelect: 'Select a project.', projectDescriptionLabel: 'Description', projectUpdated: 'Project updated.', projectSave: 'Save', projectArchivedSuccess: 'Project archived.', projectActivatedSuccess: 'Project restored to Active.', projectRestoreActive: 'Restore to Active', projectDelete: 'Delete', projectResultEmpty: 'This project has no results.', projectMoveTo: 'Move to', projectCurrentArchived: 'Current archived project',
  },
} as const;

export type UiCopyKey = keyof typeof UI_COPY.ja;

export function useUiCopy() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  const text = useCallback((key: UiCopyKey) => UI_COPY[language][key], [language]);
  return { language, text };
}
