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
  getLatestReport,
  getSprintMetrics,
  parseChaosText,
  loadBacklog,
  estimateBacklogItem,
  getSprintTasks,
  importSprintTasksFromJson,
  enrichSprintTasksFromJira,
  assignRandomIctToSprintTasks,
  getBlokCozumOnerisi,
  getJiraIssues,
  getProjectDecompositions,
} from '@/actions/actions';
import type { IssueDecomposition } from '@/actions/actions';
import type { Project, TeamMember, ProjectNote, JiraIssue, SprintTask } from '@/lib/db';
import type { BlokCozumResult } from '@/lib/gemini';
import type { DecomposeResult, SprintReportResult, ChaosResult } from '@/lib/gemini';
import type { SprintMetrics } from '@/actions/actions';
import type { BacklogItem } from '@/lib/jira';

const STATUS_CONFIG = {
  active:  { label: 'Aktif',        color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  at_risk: { label: '⚠ Risk',       color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  done:    { label: '✓ Tamamlandı', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
};

const KANBAN_COLUMNS = [
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
  const [view, setView] = useState<'kanban' | 'list' | 'backlog' | 'rapor' | 'plan'>('kanban');

  // Sprint Plan state
  const [sprintTasks, setSprintTasks] = useState<SprintTask[]>([]);
  const [planLoading, setPlanLoading] = useState(false);

  // Backlog state
  const [backlogItems, setBacklogItems] = useState<BacklogItem[]>([]);
  const [backlogTotal, setBacklogTotal] = useState(0);
  const [backlogSource, setBacklogSource] = useState<'jira' | 'mock' | null>(null);
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [backlogPage, setBacklogPage] = useState(0);
  const [backlogFilter, setBacklogFilter] = useState('');
  const [backlogPriority, setBacklogPriority] = useState<string>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [estimatingKeys, setEstimatingKeys] = useState<Set<string>>(new Set());
  const [estimatedPoints, setEstimatedPoints] = useState<Record<string, number>>({});
  const [bulkEstimating, setBulkEstimating] = useState(false);
  const PAGE_SIZE = 50;

  // AI state
  const [estimatingAll, setEstimatingAll] = useState(false);
  const [estimatingId, setEstimatingId] = useState<number | null>(null);
  const [decomposeModal, setDecomposeModal] = useState<{ issueId: number; title: string } | null>(null);
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [reportResult, setReportResult] = useState<SprintReportResult | null>(null);
  const [reportMetrics, setReportMetrics] = useState<SprintMetrics | null>(null);
  const [decompositions, setDecompositions] = useState<IssueDecomposition[]>([]);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [chaosModal, setChaosModal] = useState(false);
  const [chaosText, setChaosText] = useState('');
  const [chaosResult, setChaosResult] = useState<ChaosResult | null>(null);
  const [parsingChaos, setParsingChaos] = useState(false);

  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active;
  const isBoard = Boolean(project.board_id);

  // Kanban distribution
  const columnMap = new Map<string, JiraIssue[]>();
  for (const col of KANBAN_COLUMNS) columnMap.set(col.key, []);
  const HIDDEN_STATUSES = new Set(['Open']);
  const extraStatuses = new Set<string>();
  for (const issue of issues) {
    if (columnMap.has(issue.status)) columnMap.get(issue.status)!.push(issue);
    else if (!HIDDEN_STATUSES.has(issue.status)) {
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

  async function loadBacklogPage(page: number, reset = false) {
    setBacklogLoading(true);
    try {
      const { items, total, source } = await loadBacklog(project.id, page * PAGE_SIZE, PAGE_SIZE);
      setBacklogItems(prev => reset ? items : [...prev, ...items]);
      setBacklogTotal(total);
      setBacklogSource(source);
      setBacklogPage(page);
    } finally {
      setBacklogLoading(false);
    }
  }

  function handleViewChange(v: 'kanban' | 'list' | 'backlog' | 'rapor' | 'plan') {
    setView(v);
    if (v === 'backlog' && backlogItems.length === 0) {
      loadBacklogPage(0, true);
    }
    if (v === 'rapor') {
      loadRaporTab();
    }
    if (v === 'plan' && sprintTasks.length === 0) {
      loadPlanTab();
    }
  }

  async function loadPlanTab() {
    setPlanLoading(true);
    try {
      let tasks = await getSprintTasks(project.id);
      if (tasks.length === 0) {
        await importSprintTasksFromJson(project.id);
        tasks = await getSprintTasks(project.id);
      }
      // Assign random ICT sizes if missing
      if (tasks.length > 0 && tasks.every(t => t.ict_buyukluk === null)) {
        await assignRandomIctToSprintTasks(project.id);
        tasks = await getSprintTasks(project.id);
      }
      setSprintTasks(tasks);
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleReimportPlan() {
    setPlanLoading(true);
    try {
      await importSprintTasksFromJson(project.id);
      const tasks = await getSprintTasks(project.id);
      setSprintTasks(tasks);
    } finally {
      setPlanLoading(false);
    }
  }

  async function loadRaporTab() {
    const [metrics, decomps] = await Promise.all([
      getSprintMetrics(project.id),
      getProjectDecompositions(project.id),
    ]);
    setReportMetrics(metrics);
    setDecompositions(decomps);
    if (!reportResult && !generatingReport) {
      setGeneratingReport(true);
      try {
        const latest = await getLatestReport(project.id);
        if (latest) {
          setReportResult(JSON.parse(latest.summary) as SprintReportResult);
        } else {
          const report = await generateProjectReport(project.id);
          setReportResult(report);
        }
      } finally { setGeneratingReport(false); }
    }
  }

  async function handleEstimateSingleBacklog(item: BacklogItem) {
    setEstimatingKeys(prev => new Set(prev).add(item.key));
    try {
      const { points } = await estimateBacklogItem(item.key, item.summary);
      setEstimatedPoints(prev => ({ ...prev, [item.key]: points }));
    } finally {
      setEstimatingKeys(prev => { const s = new Set(prev); s.delete(item.key); return s; });
    }
  }

  async function handleBulkEstimate() {
    const toEstimate = [...selectedKeys].filter(k => {
      const item = backlogItems.find(i => i.key === k);
      return item && item.storyPoints == null && estimatedPoints[k] == null;
    });
    if (toEstimate.length === 0) return;
    setBulkEstimating(true);
    for (const key of toEstimate) {
      const item = backlogItems.find(i => i.key === key)!;
      setEstimatingKeys(prev => new Set(prev).add(key));
      try {
        const { points } = await estimateBacklogItem(key, item.summary);
        setEstimatedPoints(prev => ({ ...prev, [key]: points }));
      } finally {
        setEstimatingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
      }
    }
    setBulkEstimating(false);
  }

  function toggleSelect(key: string) {
    setSelectedKeys(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  }

  function toggleSelectAll(filtered: BacklogItem[]) {
    if (filtered.every(i => selectedKeys.has(i.key))) {
      setSelectedKeys(prev => { const s = new Set(prev); filtered.forEach(i => s.delete(i.key)); return s; });
    } else {
      setSelectedKeys(prev => { const s = new Set(prev); filtered.forEach(i => s.add(i.key)); return s; });
    }
  }

  async function handleEstimateAll() {
    setEstimatingAll(true);
    try {
      await estimateAllIssuePoints(project.id);
      const fresh = await getJiraIssues(project.id);
      setIssues(fresh);
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
      const [metrics, report] = await Promise.all([
        getSprintMetrics(project.id),
        generateProjectReport(project.id),
        new Promise(r => setTimeout(r, 800)),
      ] as [Promise<SprintMetrics>, Promise<SprintReportResult>, Promise<unknown>]);
      setReportMetrics(metrics);
      setReportResult(report);
    } finally { setGeneratingReport(false); }
  }

  function handleCopyReport() {
    if (!reportResult) return;
    const text = [
      `Sprint Raporu — ${project.title}`,
      '',
      reportResult.summary,
      '',
      'Bu Sprint Ne Başardık?',
      ...reportResult.accomplishments.map(a => `• ${a}`),
      '',
      'Velocity Analizi:',
      reportResult.velocity_analysis,
      ...(reportResult.risks.length > 0 ? ['', 'Riskler:', ...reportResult.risks.map(r => `⚠️ ${r}`)] : []),
      '',
      'Sonraki Sprint Önerisi:',
      reportResult.next_sprint_suggestion,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    });
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
                disabled={estimatingAll}
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
                onClick={() => handleViewChange('rapor')}
                className="text-xs px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-lg transition-all flex items-center gap-2"
              >
                <span>📊</span> Sprint Raporu & Dashboard
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
                <button onClick={() => handleViewChange('kanban')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='kanban' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  Board
                </button>
                <button onClick={() => handleViewChange('list')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='list' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  Liste
                </button>
                <button onClick={() => handleViewChange('backlog')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='backlog' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  Backlog
                </button>
                <button onClick={() => handleViewChange('rapor')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='rapor' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  📊 Rapor
                </button>
                <button onClick={() => handleViewChange('plan')}
                  className={`px-3 py-1.5 text-xs transition-colors ${view==='plan' ? 'bg-amber-400 text-blue-900 font-medium' : 'text-blue-400 hover:text-white'}`}>
                  📋 Sprint Planı
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

          {/* ─── BACKLOG VIEW ──────────────────────────────────────────── */}
          {view === 'backlog' && (
            <BacklogView
              items={backlogItems}
              total={backlogTotal}
              source={backlogSource}
              loading={backlogLoading}
              page={backlogPage}
              pageSize={PAGE_SIZE}
              filter={backlogFilter}
              priorityFilter={backlogPriority}
              selectedKeys={selectedKeys}
              estimatingKeys={estimatingKeys}
              estimatedPoints={estimatedPoints}
              bulkEstimating={bulkEstimating}
              onFilterChange={setBacklogFilter}
              onPriorityChange={setBacklogPriority}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onEstimateSingle={handleEstimateSingleBacklog}
              onBulkEstimate={handleBulkEstimate}
              onLoadMore={() => loadBacklogPage(backlogPage + 1)}
              onRefresh={() => loadBacklogPage(0, true)}
            />
          )}

          {/* ─── RAPOR & DASHBOARD VIEW ────────────────────────────────── */}
          {view === 'rapor' && (
            <ReportTabView
              metrics={reportMetrics}
              report={reportResult}
              generatingReport={generatingReport}
              reportCopied={reportCopied}
              onGenerateReport={handleGenerateReport}
              onCopyReport={handleCopyReport}
              projectTitle={project.title}
              decompositions={decompositions}
            />
          )}

          {/* ─── SPRINT PLANI VIEW ─────────────────────────────────────── */}
          {view === 'plan' && (
            <SprintPlanView
              tasks={sprintTasks}
              loading={planLoading}
              onReimport={handleReimportPlan}
            />
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
  Frontend:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Backend:   'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Database:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Test:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  DevOps:    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  Design:    'bg-pink-500/20 text-pink-300 border-pink-500/30',
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

// ─── BACKLOG VIEW COMPONENT ────────────────────────────────────────────────────

type BacklogViewProps = {
  items: BacklogItem[];
  total: number;
  source: 'jira' | 'mock' | null;
  loading: boolean;
  page: number;
  pageSize: number;
  filter: string;
  priorityFilter: string;
  selectedKeys: Set<string>;
  estimatingKeys: Set<string>;
  estimatedPoints: Record<string, number>;
  bulkEstimating: boolean;
  onFilterChange: (v: string) => void;
  onPriorityChange: (v: string) => void;
  onToggleSelect: (key: string) => void;
  onToggleSelectAll: (filtered: BacklogItem[]) => void;
  onEstimateSingle: (item: BacklogItem) => void;
  onBulkEstimate: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
};

const BL_PRIORITY_DOT: Record<string, string> = {
  Critical: 'bg-red-400', High: 'bg-orange-400', Medium: 'bg-amber-400', Low: 'bg-slate-400', None: 'bg-slate-600',
};
const BL_PRIORITY_TEXT: Record<string, string> = {
  Critical: 'text-red-300', High: 'text-orange-300', Medium: 'text-amber-300', Low: 'text-slate-400',
};
const BL_TYPE_BADGE: Record<string, string> = {
  Story: 'text-blue-300 bg-blue-500/20',
  Bug: 'text-red-300 bg-red-500/20',
  Task: 'text-slate-300 bg-slate-500/20',
  Epic: 'text-purple-300 bg-purple-500/20',
};

function BacklogView({
  items, total, source, loading, page, pageSize, filter, priorityFilter,
  selectedKeys, estimatingKeys, estimatedPoints, bulkEstimating,
  onFilterChange, onPriorityChange, onToggleSelect, onToggleSelectAll,
  onEstimateSingle, onBulkEstimate, onLoadMore, onRefresh,
}: BacklogViewProps) {
  const filtered = items.filter(i => {
    const matchText = filter === '' || i.summary.toLowerCase().includes(filter.toLowerCase()) || i.key.toLowerCase().includes(filter.toLowerCase());
    const matchPrio = priorityFilter === 'all' || i.priority === priorityFilter;
    return matchText && matchPrio;
  });

  const allSelected = filtered.length > 0 && filtered.every(i => selectedKeys.has(i.key));
  const selectedCount = filtered.filter(i => selectedKeys.has(i.key)).length;
  const needEstimate = filtered.filter(i => selectedKeys.has(i.key) && i.storyPoints == null && estimatedPoints[i.key] == null).length;
  const loaded = items.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-800/50 bg-blue-900/10 shrink-0 flex-wrap gap-y-2">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Issue ara..."
            className="pl-8 pr-3 py-1.5 bg-blue-950 border border-blue-700/50 rounded-lg text-xs text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 w-52"
          />
        </div>

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={e => onPriorityChange(e.target.value)}
          className="bg-blue-950 border border-blue-700/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
        >
          <option value="all">Tüm Öncelikler</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        {/* Stats */}
        <span className="text-xs text-blue-500">
          {filtered.length} gösterilen / {total} toplam
        </span>

        {/* Source badge */}
        {source && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${source === 'jira' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`}>
            {source === 'jira' ? '🟢 Jira Live' : '🟡 Mock Data'}
          </span>
        )}

        <div className="ml-auto flex gap-2 items-center">
          {/* Bulk estimate */}
          {selectedCount > 0 && (
            <button
              onClick={onBulkEstimate}
              disabled={bulkEstimating || needEstimate === 0}
              className="text-xs px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              {bulkEstimating
                ? <><span className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" /> Tahmin ediliyor...</>
                : <><span>🎯</span> {selectedCount} Seçiliyi Tahmin Et {needEstimate > 0 ? `(${needEstimate} SP yok)` : '(hepsi tahmin edildi)'}</>
              }
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-xs px-3 py-1.5 border border-blue-700/50 hover:border-amber-400/50 text-blue-400 hover:text-amber-400 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40"
          >
            {loading
              ? <><span className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" /> Yükleniyor...</>
              : <><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg> Yenile</>
            }
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-48 gap-3">
            <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-blue-400 text-sm">Jira backlog yükleniyor...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-blue-500 gap-2">
            <span className="text-3xl">📭</span>
            <p className="text-sm">Sonuç bulunamadı.</p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-blue-950 z-10">
              <tr className="border-b border-blue-800/50">
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleSelectAll(filtered)}
                    className="accent-amber-400 cursor-pointer"
                  />
                </th>
                <th className="text-left px-2 py-2.5 text-blue-400 font-medium w-24">Key</th>
                <th className="text-left px-2 py-2.5 text-blue-400 font-medium">Özet</th>
                <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-20">Tip</th>
                <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-20">Öncelik</th>
                <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-20">SP</th>
                <th className="text-left px-2 py-2.5 text-blue-400 font-medium w-32">Kişi</th>
                <th className="w-24 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const sp = item.storyPoints ?? estimatedPoints[item.key] ?? null;
                const isEstimated = item.storyPoints == null && estimatedPoints[item.key] != null;
                const isSelected = selectedKeys.has(item.key);
                const isEstimating = estimatingKeys.has(item.key);

                return (
                  <tr
                    key={item.key}
                    onClick={() => onToggleSelect(item.key)}
                    className={`border-b border-blue-800/30 cursor-pointer transition-colors ${isSelected ? 'bg-amber-400/8 hover:bg-amber-400/12' : idx % 2 === 0 ? 'bg-blue-900/20 hover:bg-blue-900/40' : 'hover:bg-blue-900/30'}`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(item.key)}
                        className="accent-amber-400 cursor-pointer"
                      />
                    </td>

                    {/* Key */}
                    <td className="px-2 py-2.5">
                      <span className="font-mono text-amber-400/80 whitespace-nowrap">{item.key}</span>
                    </td>

                    {/* Summary */}
                    <td className="px-2 py-2.5">
                      <span className="text-white line-clamp-2 leading-tight">{item.summary}</span>
                    </td>

                    {/* Type */}
                    <td className="px-2 py-2.5 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${BL_TYPE_BADGE[item.issueType] ?? 'text-slate-300 bg-slate-500/20'}`}>
                        {item.issueType}
                      </span>
                    </td>

                    {/* Priority */}
                    <td className="px-2 py-2.5 text-center">
                      <span className={`flex items-center justify-center gap-1 ${BL_PRIORITY_TEXT[item.priority] ?? 'text-slate-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${BL_PRIORITY_DOT[item.priority] ?? 'bg-slate-500'}`} />
                        {item.priority}
                      </span>
                    </td>

                    {/* Story Points */}
                    <td className="px-2 py-2.5 text-center">
                      {isEstimating ? (
                        <span className="w-4 h-4 border border-purple-400 border-t-transparent rounded-full animate-spin inline-block" />
                      ) : sp != null ? (
                        <span className={`px-2 py-0.5 rounded font-bold ${isEstimated ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : SP_COLOR(sp)}`}>
                          {sp}{isEstimated && ' ✨'}
                        </span>
                      ) : (
                        <span className="text-blue-700">—</span>
                      )}
                    </td>

                    {/* Assignee */}
                    <td className="px-2 py-2.5">
                      <span className="text-blue-400 truncate block max-w-[120px]">{item.assignee}</span>
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      {sp == null && !isEstimating && (
                        <button
                          onClick={() => onEstimateSingle(item)}
                          className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-all whitespace-nowrap"
                        >
                          🎯 Tahmin
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Load more */}
        {!loading && loaded < total && (
          <div className="flex justify-center py-6">
            <button
              onClick={onLoadMore}
              className="px-5 py-2 text-xs border border-blue-700/50 hover:border-amber-400/50 text-blue-400 hover:text-amber-400 rounded-lg transition-all"
            >
              Daha Fazla Yükle ({loaded} / {total})
            </button>
          </div>
        )}
      </div>

      {/* Selection summary bar */}
      {selectedCount > 0 && (
        <div className="shrink-0 border-t border-amber-500/20 bg-amber-500/5 px-5 py-2.5 flex items-center gap-4">
          <span className="text-xs text-amber-300 font-medium">{selectedCount} issue seçildi</span>
          <span className="text-xs text-blue-500">
            {filtered.filter(i => selectedKeys.has(i.key) && (i.storyPoints != null || estimatedPoints[i.key] != null))
              .reduce((s, i) => s + (i.storyPoints ?? estimatedPoints[i.key] ?? 0), 0)} SP toplam
          </span>
          <button
            onClick={() => filtered.forEach(i => selectedKeys.has(i.key) && onToggleSelect(i.key))}
            className="text-xs text-blue-500 hover:text-blue-300 ml-auto"
          >
            Seçimi Temizle
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SPRINT REPORT + DASHBOARD TAB ────────────────────────────────────────────

const DONE_STATUSES_SET = new Set(['Done', 'Canlı', 'Ready For Release', 'Closed', 'Resolved']);
const IN_PROG_STATUSES_SET = new Set(['In Progress', 'Development', 'Development Done', 'Test', 'Ready to Test', 'Analysis Done']);
const PRIORITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, None: 4 };

function ReportTabView({
  metrics,
  report,
  generatingReport,
  reportCopied,
  onGenerateReport,
  onCopyReport,
  decompositions,
}: {
  metrics: SprintMetrics | null;
  report: SprintReportResult | null;
  generatingReport: boolean;
  reportCopied: boolean;
  onGenerateReport: () => void;
  onCopyReport: () => void;
  projectTitle: string;
  decompositions: IssueDecomposition[];
}) {
  const plannedSP = metrics?.plannedSP ?? 0;
  const doneSP = metrics?.doneSP ?? 0;
  const inProgressSP = metrics?.inProgressSP ?? 0;
  const donePct   = plannedSP > 0 ? (doneSP / plannedSP) * 100 : 0;
  const inProgPct = plannedSP > 0 ? (inProgressSP / plannedSP) * 100 : 0;
  const openPct   = Math.max(0, 100 - donePct - inProgPct);
  const completionRate = metrics?.completionRate ?? 0;
  const rateColor = completionRate >= 70 ? 'text-emerald-400' : completionRate >= 40 ? 'text-amber-400' : 'text-red-400';

  const hs = metrics?.healthScore ?? 0;
  const hsColor   = hs >= 80 ? '#10b981' : hs >= 60 ? '#f59e0b' : hs >= 40 ? '#f97316' : '#ef4444';
  const hsBg      = hs >= 80 ? 'border-emerald-500/40 bg-emerald-500/5' : hs >= 60 ? 'border-amber-500/40 bg-amber-500/5' : hs >= 40 ? 'border-orange-500/40 bg-orange-500/5' : 'border-red-500/40 bg-red-500/5';
  const hsTextCol = hs >= 80 ? 'text-emerald-400' : hs >= 60 ? 'text-amber-400' : hs >= 40 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">

      {/* ── Sprint Health Score ────────────────────────────────────── */}
      {metrics && (
        <div className={`border rounded-2xl p-5 ${hsBg}`}>
          <div className="flex items-center gap-6">

            {/* Gauge ring */}
            <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
              <svg width="96" height="96" viewBox="0 0 96 96">
                {/* Track */}
                <circle cx="48" cy="48" r="40" fill="none" stroke="#1e3a5f" strokeWidth="10" />
                {/* Arc */}
                <circle
                  cx="48" cy="48" r="40" fill="none"
                  stroke={hsColor} strokeWidth="10"
                  strokeDasharray={`${(hs / 100) * 251.2} 251.2`}
                  strokeLinecap="round"
                  transform="rotate(-90 48 48)"
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-black leading-none ${hsTextCol}`}>{hs}</span>
                <span className="text-[9px] text-blue-500 mt-0.5">/ 100</span>
              </div>
            </div>

            {/* Label + components */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-lg font-bold ${hsTextCol}`}>{metrics.healthLabel}</span>
                <span className="text-xs text-blue-500">Sprint Sağlık Skoru</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {metrics.healthComponents.map(c => {
                  const pct = c.max > 0 ? (c.score / c.max) * 100 : 0;
                  const barCol = pct >= 80 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-500' : pct >= 35 ? 'bg-orange-500' : 'bg-red-500';
                  return (
                    <div key={c.label}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-blue-300">{c.label}</span>
                        <span className="text-xs font-semibold text-white">{c.score}<span className="text-blue-600">/{c.max}</span></span>
                      </div>
                      <div className="h-1.5 bg-blue-950 rounded-full overflow-hidden mb-0.5">
                        <div className={`h-full rounded-full ${barCol} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-blue-600 leading-tight">{c.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-blue-900/50 border border-blue-800/50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{metrics ? metrics.totalIssues : '—'}</div>
          <div className="text-xs text-blue-400 mt-1">Toplam Issue</div>
        </div>
        <div className="bg-blue-900/50 border border-blue-800/50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{plannedSP || '—'}</div>
          <div className="text-xs text-blue-400 mt-1">Planlanan SP</div>
        </div>
        <div className="bg-blue-900/50 border border-emerald-700/30 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{metrics ? doneSP : '—'}</div>
          <div className="text-xs text-blue-400 mt-1">Tamamlanan SP</div>
        </div>
        <div className="bg-blue-900/50 border border-blue-800/50 rounded-xl p-4 text-center">
          <div className={`text-2xl font-bold ${rateColor}`}>{plannedSP > 0 ? `%${completionRate}` : '—'}</div>
          <div className="text-xs text-blue-400 mt-1">Tamamlanma</div>
        </div>
      </div>

      {/* ── SP Progress Bar ────────────────────────────────────────── */}
      {plannedSP > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-blue-300">Sprint İlerlemesi (Story Point bazlı)</p>
            <div className="flex items-center gap-4 text-xs text-blue-400">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Done ({doneSP} SP)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Devam ({inProgressSP} SP)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-600 inline-block" /> Devam ediyor ({metrics?.remaining} SP)</span>
            </div>
          </div>
          <div className="h-5 rounded-full overflow-hidden flex bg-slate-800">
            {donePct > 0   && <div className="bg-emerald-500 h-full transition-all" style={{ width: `${donePct}%` }} />}
            {inProgPct > 0 && <div className="bg-blue-500 h-full transition-all"    style={{ width: `${inProgPct}%` }} />}
            {openPct > 0   && <div className="bg-slate-600 h-full"                  style={{ width: `${openPct}%` }} />}
          </div>
          <div className="flex justify-between text-xs text-blue-600 mt-1">
            <span>0 SP</span>
            <span className="text-amber-400/70">Sapma: {plannedSP - doneSP > 0 ? `+${plannedSP - doneSP}` : plannedSP - doneSP} SP</span>
            <span>{plannedSP} SP</span>
          </div>
        </div>
      )}

      {/* ── Two-column: Metrics left — AI report right ─────────────── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Left: Status + Assignee + Priority */}
        <div className="space-y-4">

          {metrics && metrics.byStatus.length > 0 && (
            <div className="bg-blue-900/40 border border-blue-800/40 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-300 mb-3">Durum Dağılımı</p>
              <div className="space-y-2">
                {metrics.byStatus.map(s => {
                  const maxCount = Math.max(...metrics.byStatus.map(x => x.count));
                  const barPct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                  const barColor = DONE_STATUSES_SET.has(s.status)
                    ? 'bg-emerald-500/70'
                    : IN_PROG_STATUSES_SET.has(s.status)
                    ? 'bg-blue-500/70'
                    : 'bg-slate-500/70';
                  return (
                    <div key={s.status} className="flex items-center gap-2">
                      <span className="text-xs text-blue-300 w-32 truncate shrink-0">{s.status}</span>
                      <div className="flex-1 h-2 bg-blue-950 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="text-xs text-blue-400 w-5 text-right shrink-0">{s.count}</span>
                      {s.points > 0 && <span className="text-xs text-blue-600 w-10 text-right shrink-0">{s.points}SP</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {metrics && metrics.byAssignee.length > 0 && (
            <div className="bg-blue-900/40 border border-blue-800/40 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-300 mb-3">Kişi Bazlı Tamamlanma</p>
              <div className="space-y-3">
                {metrics.byAssignee.slice(0, 8).map(a => {
                  const pct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0;
                  return (
                    <div key={a.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-blue-200 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-blue-800 inline-flex items-center justify-center text-[9px] font-bold text-amber-300 shrink-0">
                            {a.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          {a.name}
                        </span>
                        <span className="text-xs text-blue-400">{a.done}/{a.total} <span className={pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}>({pct}%)</span></span>
                      </div>
                      <div className="h-1.5 bg-blue-950 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {metrics && metrics.byPriority.length > 0 && (
            <div className="bg-blue-900/40 border border-blue-800/40 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-300 mb-3">Öncelik Bazlı Tamamlanma</p>
              <div className="space-y-2">
                {metrics.byPriority
                  .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 5) - (PRIORITY_ORDER[b.priority] ?? 5))
                  .map(p => {
                    const pct = p.count > 0 ? Math.round((p.doneCount / p.count) * 100) : 0;
                    const dot = PRIORITY_DOT[p.priority] ?? 'bg-slate-500';
                    return (
                      <div key={p.priority} className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                        <span className="text-xs text-blue-300 w-16 shrink-0">{p.priority}</span>
                        <div className="flex-1 h-1.5 bg-blue-950 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-blue-500 shrink-0 w-12 text-right">{p.doneCount}/{p.count} (%{pct})</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {!metrics && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Right: AI Sprint Report */}
        <div className="bg-blue-900/40 border border-blue-800/40 rounded-xl overflow-hidden flex flex-col min-h-[400px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-blue-800/40 shrink-0">
            <p className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
              <span>🤖</span> AI Sprint Raporu
            </p>
            {report && (
              <button
                onClick={onCopyReport}
                className="text-xs px-2.5 py-1 rounded border border-blue-700/50 text-blue-400 hover:border-amber-400/50 hover:text-amber-400 transition-all flex items-center gap-1.5"
              >
                {reportCopied ? '✓ Kopyalandı' : '📋 Kopyala'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {generatingReport && !report && (
              <div className="flex flex-col items-center py-12 gap-3">
                <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-blue-400">AI sprint verilerini analiz ediyor...</p>
              </div>
            )}

            {!generatingReport && !report && (
              <div className="flex flex-col items-center py-12 gap-3">
                <p className="text-xs text-blue-400 text-center">Sprint raporu henüz oluşturulmadı.</p>
                <button
                  onClick={onGenerateReport}
                  className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs transition-all"
                >
                  📊 Rapor Oluştur
                </button>
              </div>
            )}

            {report && (
              <div className="space-y-4">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <p className="text-xs text-white leading-relaxed">{report.summary}</p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-emerald-300 mb-2 flex items-center gap-1">
                    <span>✅</span> Bu Sprint Ne Başardık?
                  </p>
                  <ul className="space-y-1">
                    {report.accomplishments.map((a, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-blue-200">
                        <span className="text-emerald-400 mt-0.5 shrink-0">•</span> {a}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-300 mb-1">📈 Velocity Analizi</p>
                  <p className="text-xs text-white">{report.velocity_analysis}</p>
                </div>

                {report.risks.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-300 mb-2 flex items-center gap-1">
                      <span>⚠️</span> Riskler
                    </p>
                    <ul className="space-y-1">
                      {report.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-blue-200">
                          <span className="text-red-400 mt-0.5 shrink-0">•</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-purple-300 mb-1">🚀 Sonraki Sprint Önerisi</p>
                  <p className="text-xs text-white">{report.next_sprint_suggestion}</p>
                </div>

                <button
                  onClick={onGenerateReport}
                  disabled={generatingReport}
                  className="w-full py-2 text-xs text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-all disabled:opacity-40"
                >
                  {generatingReport ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                      Güncelleniyor...
                    </span>
                  ) : 'Yeniden Oluştur'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Görev Kırılım Raporu ───────────────────────────────────── */}
      {decompositions.length > 0 && (
        <div className="bg-blue-900/40 border border-blue-800/40 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-800/40">
            <p className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
              <span>🔧</span> Görev Kırılım Raporu
            </p>
            <div className="flex items-center gap-3 text-xs text-blue-500">
              <span>{decompositions.length} issue parçalandı</span>
              <span className="text-amber-400 font-semibold">
                {Math.round(decompositions.reduce((s, d) => s + d.totalHours, 0) * 2) / 2} saat toplam
              </span>
            </div>
          </div>

          <div className="divide-y divide-blue-800/30">
            {decompositions.map(d => (
              <DecompositionRow key={d.issueId} decomposition={d} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DecompositionRow({ decomposition: d }: { decomposition: IssueDecomposition }) {
  const [open, setOpen] = useState(false);
  const totalHours = Math.round(d.totalHours * 2) / 2;
  const typeCount = [...new Set(d.subtasks.map(s => s.type))].length;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-blue-800/20 transition-colors text-left"
      >
        <span className={`text-blue-500 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-mono text-amber-400/80 text-xs w-28 shrink-0">{d.jiraId}</span>
        <span className="flex-1 text-xs text-blue-200 truncate">{d.summary}</span>
        <span className="text-xs text-blue-500 shrink-0">{d.subtasks.length} alt görev</span>
        <span className="text-xs text-blue-500 shrink-0 w-20 text-right">{typeCount} alan</span>
        <span className="text-xs font-semibold text-amber-400 shrink-0 w-16 text-right">{totalHours}h</span>
      </button>

      {open && (
        <div className="px-5 pb-4">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-blue-800/30">
                <th className="text-left py-2 pr-3 text-blue-500 font-medium w-8">#</th>
                <th className="text-left py-2 pr-3 text-blue-500 font-medium">Alt Görev</th>
                <th className="text-left py-2 pr-3 text-blue-500 font-medium w-24">Tip</th>
                <th className="text-left py-2 pr-3 text-blue-500 font-medium w-32">Atanan</th>
                <th className="text-right py-2 text-blue-500 font-medium w-16">Süre</th>
              </tr>
            </thead>
            <tbody>
              {d.subtasks.map((st, i) => (
                <tr key={i} className="border-b border-blue-800/20 hover:bg-blue-800/10">
                  <td className="py-2 pr-3 text-blue-700">{i + 1}</td>
                  <td className="py-2 pr-3 text-blue-200">{st.title}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${TYPE_COLOR[st.type] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'}`}>
                      {st.type}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-blue-800 inline-flex items-center justify-center text-[9px] font-bold text-amber-300 shrink-0">
                        {(st.assigned_to ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-blue-300 text-xs truncate">{st.assigned_to ?? '—'}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="text-amber-400 font-semibold">{st.estimated_hours ?? '—'}h</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-blue-700/40">
                <td colSpan={4} className="pt-2 text-xs text-blue-500 text-right pr-3">Toplam Tahmini Süre</td>
                <td className="pt-2 text-right text-sm font-bold text-amber-400">{totalHours}h</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── SPRINT PLANI VIEW ─────────────────────────────────────────────────────────

function SprintPlanView({
  tasks,
  loading,
  onReimport,
}: {
  tasks: SprintTask[];
  loading: boolean;
  onReimport: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [onlyDated, setOnlyDated] = useState(false);
  const [blokModal, setBlokModal] = useState<{ no: string; blokNedeni: string } | null>(null);
  const [blokCozum, setBlokCozum] = useState<BlokCozumResult | null>(null);
  const [blokLoading, setBlokLoading] = useState(false);

  async function handleBlokClick(no: string, blokNedeni: string) {
    setBlokModal({ no, blokNedeni });
    setBlokCozum(null);
    setBlokLoading(true);
    try {
      const result = await getBlokCozumOnerisi(blokNedeni, no);
      setBlokCozum(result);
    } finally {
      setBlokLoading(false);
    }
  }

  const sprints = [...new Set(tasks.map(t => t.sprint_no).filter(Boolean) as number[])].sort((a, b) => a - b);

  const filtered = tasks.filter(t => {
    if (filter && !t.no.toLowerCase().includes(filter.toLowerCase())) return false;
    if (sprintFilter !== 'all' && String(t.sprint_no) !== sprintFilter) return false;
    if (onlyDated && !t.tamamlanma_tarihi) return false;
    return true;
  });

  const withDate = tasks.filter(t => t.tamamlanma_tarihi).length;
  const withoutDate = tasks.length - withDate;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-blue-400 text-sm">Sprint planı yükleniyor...</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-blue-500">
        <span className="text-4xl">📋</span>
        <p className="text-sm">Sprint planı verisi bulunamadı.</p>
        <p className="text-xs text-blue-600">Overvibe_Tasklar_Enriched.json dosyası proje dizininde olmalı.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-800/50 bg-blue-900/10 shrink-0 flex-wrap gap-y-2">
        {/* KPI badges */}
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
            ✓ {withDate} tarihli
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-400 border border-slate-500/25">
            — {withoutDate} devam ediyor
          </span>
          <span className="text-xs text-blue-500">{tasks.length} toplam</span>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="No ara (ICTREQ-...)"
            className="pl-8 pr-3 py-1.5 bg-blue-950 border border-blue-700/50 rounded-lg text-xs text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 w-44"
          />
        </div>

        {/* Sprint filter */}
        <select
          value={sprintFilter}
          onChange={e => setSprintFilter(e.target.value)}
          className="bg-blue-950 border border-blue-700/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
        >
          <option value="all">Tüm Sprintler</option>
          <option value="null">Sprint Atanmamış</option>
          {sprints.map(s => (
            <option key={s} value={String(s)}>Sprint {s}</option>
          ))}
        </select>

        {/* Only dated toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyDated}
            onChange={e => setOnlyDated(e.target.checked)}
            className="accent-emerald-400"
          />
          <span className="text-xs text-blue-300">Sadece tamamlanan</span>
        </label>

        <span className="text-xs text-blue-600">{filtered.length} gösterilen</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-blue-950 z-10">
            <tr className="border-b border-blue-800/50">
              <th className="text-left px-4 py-2.5 text-blue-400 font-medium w-36">No</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-20">Sprint</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-28">Backlog Giriş</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-28">Sprint Başlangıç</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-28">Sprint Bitiş</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-32">Tamamlanma Tarihi</th>
              <th className="text-center px-2 py-2.5 text-blue-400 font-medium w-px whitespace-nowrap">ICT Büyüklük</th>
              <th className="text-left px-2 py-2.5 text-blue-400 font-medium w-px whitespace-nowrap">Blok Nedeni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task, idx) => {
              const hasDone = Boolean(task.tamamlanma_tarihi);
              const isLate = hasDone && task.sprint_bitis && task.tamamlanma_tarihi
                ? task.tamamlanma_tarihi > task.sprint_bitis
                : false;
              return (
                <tr
                  key={task.id}
                  className={`border-b border-blue-800/20 transition-colors ${
                    isLate
                      ? 'bg-red-900/15 hover:bg-red-900/25'
                      : hasDone
                      ? 'bg-emerald-900/10 hover:bg-emerald-900/20'
                      : idx % 2 === 0
                      ? 'bg-blue-900/15 hover:bg-blue-900/30'
                      : 'hover:bg-blue-900/20'
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-amber-400/80 text-xs whitespace-nowrap">{task.no}</span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {task.sprint_no != null ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
                        {task.sprint_no}
                      </span>
                    ) : (
                      <span className="text-blue-700">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="text-blue-400 text-xs">{task.backlog_giris_tarihi ?? '—'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="text-blue-400 text-xs">{task.sprint_baslangic ?? '—'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="text-blue-400 text-xs">{task.sprint_bitis ?? '—'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {hasDone ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap border ${
                        isLate
                          ? 'bg-red-500/20 text-red-300 border-red-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {isLate ? '⚠ ' : '✓ '}{task.tamamlanma_tarihi}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Devam ediyor
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center w-px whitespace-nowrap">
                    {task.ict_sp != null ? (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${
                          task.ict_sp <= 2
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : task.ict_sp <= 5
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-red-500/20 text-red-300 border-red-500/30'
                        }`}
                        title={task.ict_buyukluk ?? undefined}
                      >
                        {task.ict_buyukluk} · {task.ict_sp} SP
                      </span>
                    ) : (
                      <span className="text-blue-800 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 w-px whitespace-nowrap">
                    {task.blok_nedeni ? (
                      <button
                        onClick={() => handleBlokClick(task.no, task.blok_nedeni!)}
                        className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/25 whitespace-nowrap hover:bg-red-500/30 hover:border-red-400/50 transition-all cursor-pointer"
                        title="AI çözüm önerilerini gör"
                      >
                        {task.blok_nedeni} ✨
                      </button>
                    ) : (
                      <span className="text-blue-800 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── BLOK NEDENİ ÇÖZÜM MODAL ─────────────────────────────────── */}
      {blokModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget && !blokLoading) { setBlokModal(null); setBlokCozum(null); } }}
        >
          <div className="bg-blue-900 border border-blue-700/60 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between px-6 py-4 border-b border-blue-800/50">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>✨</span> AI Blokaj Çözüm Önerileri
                </h2>
                <p className="text-xs text-amber-300 mt-1 font-mono">{blokModal.no}</p>
                <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                  {blokModal.blokNedeni}
                </span>
              </div>
              {!blokLoading && (
                <button
                  onClick={() => { setBlokModal(null); setBlokCozum(null); }}
                  className="text-blue-400 hover:text-white text-xl shrink-0 ml-4"
                >✕</button>
              )}
            </div>

            <div className="px-6 py-5">
              {blokLoading && (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-blue-400">AI blokaj analiz ediyor ve çözüm üretiyor...</p>
                </div>
              )}

              {blokCozum && !blokLoading && (
                <div className="space-y-4">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                    <p className="text-xs text-blue-200 leading-relaxed">{blokCozum.ozet}</p>
                  </div>

                  <div className="space-y-2.5">
                    {blokCozum.oneriler.map((o, i) => (
                      <div key={i} className="bg-blue-950/60 border border-blue-800/40 rounded-xl px-4 py-3 flex gap-3">
                        <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-white mb-0.5">{o.baslik}</p>
                          <p className="text-xs text-blue-400 leading-relaxed">{o.aciklama}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => { setBlokCozum(null); handleBlokClick(blokModal.no, blokModal.blokNedeni); }}
                    className="w-full py-2 text-xs text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-all"
                  >
                    Yeniden Üret
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
