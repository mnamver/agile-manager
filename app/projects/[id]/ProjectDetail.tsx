'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addNote,
  deleteNote,
  updateProjectStatus,
  refreshJiraIssues,
  refreshBoardIssues,
  estimateIssuePoints,
  estimateAllIssuePoints,
  decomposeIssue,
  generateProjectReport,
  parseChaosText,
} from '@/actions/actions';
import type { Project, TeamMember, ProjectNote, JiraIssue } from '@/lib/db';
import type { DecomposeResult, SprintReportResult, ChaosResult } from '@/lib/gemini';

const STATUS_CONFIG = {
  active:  { label: 'Aktif',        color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  at_risk: { label: '⚠ Risk',       color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  done:    { label: '✓ Tamamlandı', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
};

const KANBAN_COLUMNS = [
  { key: 'Open',              label: 'Open',              color: 'border-slate-500',   bg: 'bg-slate-500/10'   },
  { key: 'Analysis Done',     label: 'Analysis Done',     color: 'border-violet-500',  bg: 'bg-violet-500/10'  },
  { key: 'Development',       label: 'Development',       color: 'border-blue-500',    bg: 'bg-blue-500/10'    },
  { key: 'Development Done',  label: 'Development Done',  color: 'border-cyan-500',    bg: 'bg-cyan-500/10'    },
  { key: 'Ready to Test',     label: 'Ready to Test',     color: 'border-yellow-500',  bg: 'bg-yellow-500/10'  },
  { key: 'Test',              label: 'Test',              color: 'border-orange-500',  bg: 'bg-orange-500/10'  },
  { key: 'Ready For Release', label: 'Ready For Release', color: 'border-emerald-500', bg: 'bg-emerald-500/10' },
];

const PRIORITY_DOT: Record<string, string> = {
  Critical: 'bg-red-400', High: 'bg-orange-400', Medium: 'bg-amber-400', Low: 'bg-slate-400', None: 'bg-slate-600',
};

const SP_COLOR = (p: number) =>
  p <= 3 ? 'bg-emerald-500/20 text-emerald-300' :
  p <= 8 ? 'bg-amber-500/20 text-amber-300' :
           'bg-red-500/20 text-red-300';

export default function ProjectDetail({
  project, members, notes: initialNotes, issues: initialIssues,
}: {
  project: Project;
  members: TeamMember[];
  notes: ProjectNote[];
  issues: JiraIssue[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notes, setNotes] = useState(initialNotes);
  const [issues, setIssues] = useState(initialIssues);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');

  // AI state
  const [estimatingAll, setEstimatingAll] = useState(false);
  const [estimatingId, setEstimatingId] = useState<number | null>(null);
  const [decomposeModal, setDecomposeModal] = useState<{ issueId: number; title: string } | null>(null);
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportResult, setReportResult] = useState<SprintReportResult | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [chaosModal, setChaosModal] = useState(false);
  const [chaosText, setChaosText] = useState('');
  const [chaosResult, setChaosResult] = useState<ChaosResult | null>(null);
  const [parsingChaos, setParsingChaos] = useState(false);

  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active;
  const isBoard = Boolean(project.board_id);

  // Kanban distribution
  const columnMap = new Map<string, JiraIssue[]>();
  for (const col of KANBAN_COLUMNS) columnMap.set(col.key, []);
  const extraStatuses = new Set<string>();
  for (const issue of issues) {
    if (columnMap.has(issue.status)) columnMap.get(issue.status)!.push(issue);
    else {
      extraStatuses.add(issue.status);
      if (!columnMap.has(issue.status)) columnMap.set(issue.status, []);
      columnMap.get(issue.status)!.push(issue);
    }
  }
  const allColumns = [
    ...KANBAN_COLUMNS,
    ...[...extraStatuses].map(s => ({ key: s, label: s, color: 'border-slate-400', bg: 'bg-slate-400/10' })),
  ].filter(col => (columnMap.get(col.key) ?? []).length > 0 || KANBAN_COLUMNS.includes(col));

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const newNote = await addNote(project.id, noteText);
      setNotes(n => [newNote, ...n]);
      setNoteText('');
    } finally { setAddingNote(false); }
  }

  async function handleDeleteNote(noteId: number) {
    await deleteNote(noteId, project.id);
    setNotes(n => n.filter(note => note.id !== noteId));
  }

  async function handleStatusChange(s: 'active' | 'at_risk' | 'done') {
    setUpdatingStatus(true);
    await updateProjectStatus(project.id, s);
    setUpdatingStatus(false);
    startTransition(() => router.refresh());
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const fresh = isBoard
        ? await refreshBoardIssues(project.id, project.board_id!)
        : project.jira_key
          ? await refreshJiraIssues(project.id, project.jira_key)
          : issues;
      setIssues(fresh);
    } finally { setRefreshing(false); }
  }

  async function handleEstimateAll() {
    setEstimatingAll(true);
    try {
      await estimateAllIssuePoints(project.id);
      startTransition(() => router.refresh());
    } finally { setEstimatingAll(false); }
  }

  async function handleEstimateSingle(issueId: number) {
    setEstimatingId(issueId);
    try {
      const result = await estimateIssuePoints(issueId, project.id);
      setIssues(prev => prev.map(i => i.id === issueId ? { ...i, story_points: result.points } : i));
    } finally { setEstimatingId(null); }
  }

  async function handleDecompose() {
    if (!decomposeModal) return;
    setDecomposing(true);
    setDecomposeResult(null);
    try {
      const [result] = await Promise.all([
        decomposeIssue(decomposeModal.issueId, project.id),
        new Promise<void>(r => setTimeout(r, 700)),
      ]);
      setDecomposeResult(result);
    } catch (e) {
      console.error('Decompose hatası:', e);
    } finally {
      setDecomposing(false);
    }
  }

  async function handleGenerateReport() {
    setGeneratingReport(true);
    setReportResult(null);
    try {
      const result = await generateProjectReport(project.id);
      setReportResult(result);
    } finally { setGeneratingReport(false); }
  }

  async function handleParseChaos() {
    if (!chaosText.trim()) return;
    setParsingChaos(true);
    setChaosResult(null);
    try {
      const result = await parseChaosText(chaosText, project.id);
      setChaosResult(result);
      startTransition(() => router.refresh());
    } finally { setParsingChaos(false); }
  }

  const roleGroups = members.reduce<Record<string, TeamMember[]>>((acc, m) => {
    const role = m.role || 'Developer';
    if (!acc[role]) acc[role] = [];
    acc[role].push(m);
    return acc;
  }, {});

  const hasUnestimated = issues.some(i => i.story_points == null);

  return (
    <div className="min-h-screen bg-blue-950 text-white">
      {/* Header */}
      <header className="bg-blue-900/80 backdrop-blur border-b border-blue-800/50 sticky top-0 z-30">
        <div className="max-w-full px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-blue-400 hover:text-amber-400 transition-colors text-sm shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Projeler
          </Link>
          <span className="text-blue-700">/</span>
          <h1 className="text-sm font-semibold text-white truncate flex-1">{project.title}</h1>
          {isBoard && (
            <span className="text-xs bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full shrink-0">
              Board #{project.board_id}
            </span>
          )}
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ${status.color}`}>
            {status.label}
          </span>
        </div>
      </header>

      <div className="flex h-[calc(100vh-49px)]">
        {/* Left Sidebar */}
        <aside className="w-72 shrink-0 border-r border-blue-800/50 overflow-y-auto bg-blue-900/30 flex flex-col gap-4 p-4">
          {/* Project Info */}
          <div>
            <h2 className="text-base font-bold text-white mb-1">{project.title}</h2>
            {project.description && (
              <p className="text-blue-400 text-xs leading-relaxed">{project.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {project.jira_key && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h11.5A2.25 2.25 0 0018 15.75V4.25A2.25 2.25 0 0015.75 2H4.25zm4.03 6.28a.75.75 0 00-1.06-1.06L5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75zm5.5 0a.75.75 0 00-1.06-1.06L10.5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75z" clipRule="evenodd" />
                  </svg>
                  {project.jira_key}
                </span>
              )}
              {project.target_date && (
                <span className="text-xs text-blue-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25" />
                  </svg>
                  {new Date(project.target_date).toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' })}
                </span>
              )}
            </div>
          </div>

          {/* Status */}
          <div>
            <p className="text-xs text-blue-500 mb-2">Proje Durumu</p>
            <div className="flex flex-col gap-1.5">
              {(['active','at_risk','done'] as const).map(s => (
                <button key={s} disabled={project.status===s || updatingStatus} onClick={() => handleStatusChange(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg border text-left transition-all ${project.status===s ? STATUS_CONFIG[s].color + ' font-medium' : 'border-blue-700/40 text-blue-400 hover:border-amber-400/50 hover:text-amber-400'} disabled:cursor-not-allowed`}>
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Tools */}
          <div className="border border-purple-500/30 rounded-xl p-3 bg-purple-500/5">
            <p className="text-xs font-semibold text-purple-300 mb-3 flex items-center gap-1.5">
              <span>✨</span> AI Araçları
            </p>
            <div className="flex flex-col gap-2">
              {/* Estimate All */}
              <button
                onClick={handleEstimateAll}
                disabled={estimatingAll || !hasUnestimated}
                className="text-xs px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-lg transition-all disabled:opacity-40 flex items-center gap-2"
              >
                {estimatingAll ? (
                  <><span className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin shrink-0" /> Story Point Tahmini Yapılıyor...</>
                ) : (
                  <><span>🎯</span> Tüm Story Point&apos;leri Tahmin Et</>
                )}
              </button>

              {/* Sprint Report */}
              <button
                onClick={() => { setReportModal(true); handleGenerateReport(); }}
                disabled={generatingReport}
                className="text-xs px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-lg transition-all disabled:opacity-40 flex items-center gap-2"
              >
                <span>📊</span> Sprint Raporu Oluştur
              </button>

              {/* Chaos to Clarity */}
              <button
                onClick={() => setChaosModal(true)}
                className="text-xs px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition-all flex items-center gap-2"
              >
                <span>⚡</span> Chaos to Clarity
              </button>
            </div>
          </div>

          {/* Team */}
          <div>
            <p className="text-xs text-blue-500 mb-2">Ekip ({members.length} kişi)</p>
            {Object.entries(roleGroups).map(([role, ms]) => (
              <div key={role} className="mb-3">
                <p className="text-xs text-blue-600 mb-1">{role}</p>
                {ms.map(m => (
                  <div key={m.id} className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-xs font-semibold text-amber-400 shrink-0">
                      {m.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                    <span className="text-xs text-blue-200 truncate">{m.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="flex-1">
            <p className="text-xs text-blue-500 mb-2">Notlar ({notes.length})</p>
            <div className="flex gap-1.5 mb-2">
              <input value={noteText} onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key==='Enter' && !e.shiftKey && handleAddNote()}
                placeholder="Not ekle..." className="flex-1 bg-blue-950 border border-blue-700/50 rounded px-2 py-1.5 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-xs" />
              <button onClick={handleAddNote} disabled={addingNote || !noteText.trim()}
                className="px-2.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-blue-900 rounded text-xs font-bold disabled:opacity-40">
                {addingNote ? '…' : '+'}
              </button>
            </div>
            <div className="space-y-1.5">
              {notes.map(note => (
                <div key={note.id} className="bg-blue-950/60 rounded px-2.5 py-2 group flex gap-1.5">
                  <p className="flex-1 text-xs text-blue-300">{note.content}</p>
                  <button onClick={() => handleDeleteNote(note.id)}
                    className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-red-400 text-xs shrink-0">✕</button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main: Kanban Board */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Board Toolbar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-800/50 bg-blue-900/20 shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h11.5A2.25 2.25 0 0018 15.75V4.25A2.25 2.25 0 0015.75 2H4.25zm4.03 6.28a.75.75 0 00-1.06-1.06L5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75zm5.5 0a.75.75 0 00-1.06-1.06L10.5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-white">
                {isBoard ? `Board #${project.board_id}` : `${project.jira_key} Issues`}
              </span>
              <span className="text-xs text-blue-400 bg-blue-800/60 px-2 py-0.5 rounded-full">
                {issues.length} issue
              </span>
            </div>
            <div className="flex gap-1 ml-auto">
              <div className="flex border border-blue-700/50 rounded-lg overflow-hidden">
                <button onClick={() => setView('kanban')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='kanban' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  Board
                </button>
                <button onClick={() => setView('list')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='list' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  Liste
                </button>
              </div>
              {(isBoard || project.jira_key) && (
                <button onClick={handleRefresh} disabled={refreshing}
                  className="flex items-center gap-1.5 text-xs border border-blue-700/50 hover:border-amber-400/50 text-blue-400 hover:text-amber-400 px-3 py-1.5 rounded-lg transition-all">
                  {refreshing ? (
                    <><span className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" /> Güncelleniyor...</>
                  ) : (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg> Jira&apos;dan Güncelle</>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Board Content */}
          {view === 'kanban' ? (
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex gap-4 p-5 h-full min-w-max">
                {allColumns.map(col => {
                  const colIssues = columnMap.get(col.key) ?? [];
                  return (
                    <div key={col.key} className="flex flex-col w-64 shrink-0 h-full">
                      <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 ${col.color} bg-blue-900/50`}>
                        <span className="text-xs font-semibold text-white">{col.label}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${colIssues.length > 0 ? 'bg-amber-400 text-blue-900' : 'bg-blue-800 text-blue-400'}`}>
                          {colIssues.length}
                        </span>
                      </div>
                      <div className={`flex-1 overflow-y-auto rounded-b-lg ${col.bg} border border-blue-800/30 border-t-0 p-2 space-y-2`}>
                        {colIssues.length === 0 && (
                          <div className="text-center py-6 text-blue-700 text-xs">Boş</div>
                        )}
                        {colIssues.map((issue, idx) => (
                          <IssueCard
                            key={issue.id}
                            issue={issue}
                            index={idx}
                            estimating={estimatingId === issue.id}
                            onEstimate={() => handleEstimateSingle(issue.id)}
                            onDecompose={() => setDecomposeModal({ issueId: issue.id, title: issue.summary })}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-3xl space-y-2">
                {issues.map((issue, i) => (
                  <div key={issue.id}
                    className="flex items-start gap-3 bg-blue-900/40 border border-blue-800/50 rounded-xl px-4 py-3 hover:bg-blue-900/60 transition-all"
                    style={{ animationDelay: `${i * 30}ms` }}>
                    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[issue.priority] ?? 'bg-slate-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono text-amber-400/80">{issue.jira_id}</span>
                        <span className="text-xs text-blue-500">{issue.issue_type}</span>
                        {issue.story_points != null && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${SP_COLOR(issue.story_points)}`}>
                            {issue.story_points} SP
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white">{issue.summary}</p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <StatusPill status={issue.status} />
                      <p className="text-xs text-blue-500">{issue.assignee}</p>
                      <div className="flex gap-1 mt-1">
                        {issue.story_points == null && (
                          <button
                            onClick={() => handleEstimateSingle(issue.id)}
                            disabled={estimatingId === issue.id}
                            className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                          >
                            {estimatingId === issue.id ? '...' : '🎯'}
                          </button>
                        )}
                        <button
                          onClick={() => setDecomposeModal({ issueId: issue.id, title: issue.summary })}
                          className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                        >
                          ⚙️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ─── DECOMPOSE MODAL ─────────────────────────────────────────── */}
      {decomposeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && !decomposing && setDecomposeModal(null)}>
          <div className="bg-blue-900 border border-blue-700/60 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-800/50">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>⚙️</span> AI Görev Kırılımı
                </h2>
                <p className="text-xs text-blue-400 mt-0.5 truncate max-w-md">{decomposeModal.title}</p>
              </div>
              {!decomposing && (
                <button onClick={() => setDecomposeModal(null)} className="text-blue-400 hover:text-white text-xl">✕</button>
              )}
            </div>
            <div className="px-6 py-5">
              {!decomposeResult && !decomposing && (
                <div className="text-center py-8">
                  <p className="text-blue-300 mb-6 text-sm">Bu task AI tarafından alt görevlere bölünecek ve takım üyelerine atanacak.</p>
                  <button onClick={handleDecompose}
                    className="px-6 py-3 bg-purple-500 hover:bg-purple-400 text-white font-semibold rounded-xl transition-all">
                    ✨ AI ile Parçala ve Ata
                  </button>
                </div>
              )}
              {decomposing && (
                <div className="flex flex-col items-center py-12 gap-4">
                  <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-purple-300 text-sm">AI analiz ediyor ve alt görevler oluşturuluyor...</p>
                </div>
              )}
              {decomposeResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-blue-950/60 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-amber-400">{decomposeResult.subtasks.length}</div>
                      <div className="text-xs text-blue-400">Alt Görev</div>
                    </div>
                    <div className="bg-blue-950/60 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{decomposeResult.total_estimated_hours}h</div>
                      <div className="text-xs text-blue-400">Toplam Süre</div>
                    </div>
                  </div>

                  {decomposeResult.risk_note && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-xs text-amber-300">
                      ⚠️ {decomposeResult.risk_note}
                    </div>
                  )}

                  <div className="space-y-2">
                    {decomposeResult.subtasks.map((st, i) => (
                      <div key={i} className="bg-blue-950/60 border border-blue-800/50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLOR[st.type] ?? 'bg-slate-500/20 text-slate-300'}`}>
                            {st.type}
                          </span>
                          <span className="text-xs text-blue-400">{st.estimated_hours}h</span>
                        </div>
                        <p className="text-sm text-white mb-1">{st.title}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-blue-400 flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-blue-700 inline-flex items-center justify-center text-[9px] font-bold text-amber-300">
                              {st.assigned_to.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}
                            </span>
                            {st.assigned_to}
                          </span>
                          <span className="text-xs text-blue-600 italic">{st.reasoning}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleDecompose}
                    disabled={decomposing}
                    className="w-full py-2 text-xs text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Yeniden Oluştur
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── SPRINT REPORT MODAL ──────────────────────────────────────── */}
      {reportModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && !generatingReport && setReportModal(false)}>
          <div className="bg-blue-900 border border-blue-700/60 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-800/50">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>📊</span> AI Sprint Review Raporu
              </h2>
              {!generatingReport && (
                <button onClick={() => setReportModal(false)} className="text-blue-400 hover:text-white text-xl">✕</button>
              )}
            </div>
            <div className="px-6 py-5">
              {generatingReport && (
                <div className="flex flex-col items-center py-12 gap-4">
                  <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-blue-300 text-sm">AI sprint verilerini analiz ediyor...</p>
                </div>
              )}
              {reportResult && (
                <div className="space-y-5">
                  {/* Executive Summary */}
                  <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-4">
                    <p className="text-xs font-semibold text-blue-300 mb-2">Özet</p>
                    <p className="text-sm text-white leading-relaxed">{reportResult.summary}</p>
                  </div>

                  {/* Accomplishments */}
                  <div>
                    <p className="text-xs font-semibold text-emerald-300 mb-2 flex items-center gap-1.5">
                      <span>✅</span> Bu Sprint Ne Başardık?
                    </p>
                    <ul className="space-y-1.5">
                      {reportResult.accomplishments.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-blue-200">
                          <span className="text-emerald-400 mt-0.5 shrink-0">•</span> {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Velocity */}
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-xs font-semibold text-amber-300 mb-1">Velocity Analizi</p>
                    <p className="text-sm text-white">{reportResult.velocity_analysis}</p>
                  </div>

                  {/* Risks */}
                  {reportResult.risks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-300 mb-2 flex items-center gap-1.5">
                        <span>⚠️</span> Riskler
                      </p>
                      <ul className="space-y-1.5">
                        {reportResult.risks.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-blue-200">
                            <span className="text-red-400 mt-0.5 shrink-0">•</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Next Sprint */}
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                    <p className="text-xs font-semibold text-purple-300 mb-1">Sonraki Sprint Önerisi</p>
                    <p className="text-sm text-white">{reportResult.next_sprint_suggestion}</p>
                  </div>

                  <button
                    onClick={handleGenerateReport}
                    disabled={generatingReport}
                    className="w-full py-2 text-xs text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-all disabled:opacity-40"
                  >
                    Yeniden Oluştur
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── CHAOS TO CLARITY MODAL ───────────────────────────────────── */}
      {chaosModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && !parsingChaos && setChaosModal(false)}>
          <div className="bg-blue-900 border border-blue-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-800/50">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>⚡</span> Chaos to Clarity
                </h2>
                <p className="text-xs text-amber-300 mt-0.5">Ham metni sprint task&apos;larına dönüştür</p>
              </div>
              {!parsingChaos && (
                <button onClick={() => { setChaosModal(false); setChaosResult(null); }} className="text-blue-400 hover:text-white text-xl">✕</button>
              )}
            </div>
            <div className="px-6 py-5 space-y-4">
              {!chaosResult && (
                <>
                  <div>
                    <label className="block text-xs text-blue-300 mb-2">
                      Slack mesajı, e-posta, toplantı notu — ne olursa olsun yapıştır:
                    </label>
                    <textarea
                      value={chaosText}
                      onChange={e => setChaosText(e.target.value)}
                      placeholder={`Örn: "Müşteri portalına SSO eklememiz lazım, mobil uygulama çöküyor, dashboard da yavaş. Ayrıca design ekibi yeni login ekranı istedi."`}
                      rows={6}
                      disabled={parsingChaos}
                      className="w-full bg-blue-950 border border-blue-700/50 rounded-xl px-4 py-3 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-sm resize-none"
                    />
                  </div>
                  <button
                    onClick={handleParseChaos}
                    disabled={parsingChaos || !chaosText.trim()}
                    className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-blue-900 font-bold rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {parsingChaos ? (
                      <><span className="w-4 h-4 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /> AI Analiz Ediyor...</>
                    ) : (
                      <>⚡ Chaos&apos;u Sprint Plan&apos;ına Dönüştür</>
                    )}
                  </button>
                </>
              )}

              {chaosResult && (
                <div className="space-y-4">
                  {/* Summary bar */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-950/60 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-amber-400">{chaosResult.tasks.length}</div>
                      <div className="text-xs text-blue-400">Task Oluşturuldu</div>
                    </div>
                    <div className="bg-blue-950/60 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-purple-400">{chaosResult.total_points}</div>
                      <div className="text-xs text-blue-400">Toplam Story Point</div>
                    </div>
                  </div>

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-xs text-blue-300">
                    📋 {chaosResult.sprint_feasibility}
                  </div>

                  <div className="space-y-2">
                    {chaosResult.tasks.map((task, i) => (
                      <div key={i} className="bg-blue-950/60 border border-blue-800/50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${PRIORITY_BADGE[task.priority] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'}`}>
                              {task.priority}
                            </span>
                            <span className="text-xs text-blue-500">{task.type}</span>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded font-bold ${SP_COLOR(task.story_points)}`}>
                            {task.story_points} SP
                          </span>
                        </div>
                        <p className="text-sm text-white mb-1">{task.title}</p>
                        <p className="text-xs text-blue-400 mb-2">{task.description}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-blue-400 flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-blue-700 inline-flex items-center justify-center text-[9px] font-bold text-amber-300">
                              {task.suggested_assignee.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}
                            </span>
                            {task.suggested_assignee}
                          </span>
                          <span className="text-xs text-blue-600 italic">{task.reasoning}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-xs text-emerald-300">
                    ✅ {chaosResult.tasks.length} task backlog&apos;a eklendi. Kanban board&apos;unuzda görünüyor.
                  </div>

                  <button
                    onClick={() => { setChaosResult(null); setChaosText(''); }}
                    className="w-full py-2 text-xs text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-all"
                  >
                    Yeni Metin Analiz Et
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = {
  Frontend:  'bg-cyan-500/20 text-cyan-300',
  Backend:   'bg-blue-500/20 text-blue-300',
  Database:  'bg-indigo-500/20 text-indigo-300',
  Test:      'bg-green-500/20 text-green-300',
  DevOps:    'bg-orange-500/20 text-orange-300',
  Design:    'bg-pink-500/20 text-pink-300',
};

const PRIORITY_BADGE: Record<string, string> = {
  Critical: 'bg-red-500/20 text-red-300 border-red-500/30',
  High:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  Medium:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Low:      'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

function IssueCard({
  issue, index, estimating, onEstimate, onDecompose,
}: {
  issue: JiraIssue;
  index: number;
  estimating: boolean;
  onEstimate: () => void;
  onDecompose: () => void;
}) {
  const dot = PRIORITY_DOT[issue.priority] ?? 'bg-slate-600';
  const initials = issue.assignee !== 'Atanmamış'
    ? issue.assignee.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div
      className="bg-blue-900/80 border border-blue-700/40 rounded-lg p-3 cursor-default hover:border-amber-400/40 transition-all group"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-amber-400/70 shrink-0">{issue.jira_id}</span>
        <div className="flex items-center gap-1.5">
          {issue.story_points != null ? (
            <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${SP_COLOR(issue.story_points)}`}>
              {issue.story_points}
            </span>
          ) : (
            <button
              onClick={onEstimate}
              disabled={estimating}
              title="Story point tahmin et"
              className="text-xs w-5 h-5 flex items-center justify-center rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/40 disabled:opacity-40 transition-all"
            >
              {estimating ? <span className="w-2.5 h-2.5 border border-purple-400 border-t-transparent rounded-full animate-spin" /> : '?'}
            </button>
          )}
          <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        </div>
      </div>
      <p className="text-xs text-white leading-relaxed mb-3">{issue.summary}</p>
      <div className="flex items-center justify-between">
        <button
          onClick={onDecompose}
          title="AI ile görev kırılımı yap"
          className="text-xs text-blue-500 hover:text-purple-300 bg-blue-500/10 hover:bg-purple-500/20 px-2 py-0.5 rounded transition-all"
        >
          ⚙️ Parçala
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-blue-700 flex items-center justify-center text-[10px] font-bold text-amber-300">
            {initials}
          </div>
          <span className="text-xs text-blue-400 max-w-[80px] truncate">{issue.assignee}</span>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    'Development':       'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'Development Done':  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    'Ready to Test':     'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    'Test':              'bg-orange-500/20 text-orange-300 border-orange-500/30',
    'Ready For Release': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'Analysis Done':     'bg-violet-500/20 text-violet-300 border-violet-500/30',
    'Open':              'bg-slate-500/20 text-slate-300 border-slate-500/30',
    'Done':              'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'Canlı':             'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  };
  const cls = map[status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>{status}</span>
  );
}
