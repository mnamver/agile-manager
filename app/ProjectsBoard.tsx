'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createProject } from '@/actions/actions';
import type { Project } from '@/lib/db';

type ProjectWithIssues = Project & { open_issues: number };

type Stats = {
  total: number;
  active: number;
  at_risk: number;
  done: number;
  total_members: number;
};

const STATUS_CONFIG = {
  active: { label: 'Aktif', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  at_risk: { label: '⚠ Risk', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  done: { label: '✓ Tamamlandı', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
};

const PRIORITY_COLOR: Record<string, string> = {
  Critical: 'text-red-400',
  High: 'text-orange-400',
  Medium: 'text-amber-400',
  Low: 'text-slate-400',
};

const ROLE_OPTIONS = ['Tech Lead', 'Backend', 'Frontend', 'Mobile', 'QA', 'DevOps', 'Data Engineer', 'ML Engineer'];

type Member = { name: string; role: string };

export default function ProjectsBoard({
  initialProjects,
  stats,
}: {
  initialProjects: ProjectWithIssues[];
  stats: Stats;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'at_risk' | 'done'>('all');

  const [form, setForm] = useState({
    title: '',
    description: '',
    target_date: '',
    jira_key: '',
  });
  const [members, setMembers] = useState<Member[]>([{ name: '', role: 'Backend' }]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered =
    filter === 'all' ? initialProjects : initialProjects.filter((p) => p.status === filter);

  function addMember() {
    setMembers((m) => [...m, { name: '', role: 'Developer' }]);
  }
  function removeMember(i: number) {
    setMembers((m) => m.filter((_, idx) => idx !== i));
  }
  function updateMember(i: number, field: keyof Member, val: string) {
    setMembers((m) => m.map((mem, idx) => (idx === i ? { ...mem, [field]: val } : mem)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.title.trim()) { setFormError('Proje adı zorunludur'); return; }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('target_date', form.target_date);
      fd.append('jira_key', form.jira_key);
      fd.append('members', JSON.stringify(members.filter((m) => m.name.trim())));

      const { id, jiraKey, jiraError } = await createProject(fd);
      setShowModal(false);
      setForm({ title: '', description: '', target_date: '', jira_key: '' });
      setMembers([{ name: '', role: 'Backend' }]);
      if (jiraError) {
        console.warn('Jira proje oluşturma hatası:', jiraError);
      }
      if (jiraKey) {
        console.info('Jira projesi oluşturuldu:', jiraKey);
      }
      startTransition(() => { router.refresh(); });
      router.push(`/projects/${id}`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-blue-950 text-white">
      {/* Header */}
      <header className="bg-blue-900/80 backdrop-blur border-b border-blue-800/50 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-400 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-900" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Turkcell Proje Planlama</h1>
              <p className="text-xs text-blue-300">Proje &amp; Jira Yönetim Platformu</p>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-blue-900 font-semibold px-4 py-2 rounded-lg text-sm transition-all active:scale-95 shadow-lg shadow-amber-400/20"
          >
            <span className="text-lg leading-none">+</span> Yeni Proje
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 animate-fade-in">
          {[
            { label: 'Toplam Proje', value: stats.total, icon: '📁', color: 'text-white' },
            { label: 'Aktif', value: stats.active, icon: '🟢', color: 'text-emerald-400' },
            { label: 'Risk', value: stats.at_risk, icon: '⚠️', color: 'text-amber-400' },
            { label: 'Ekip Üyesi', value: stats.total_members, icon: '👥', color: 'text-blue-300' },
          ].map((s) => (
            <div key={s.label} className="bg-blue-900/60 border border-blue-800/50 rounded-xl p-4">
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-blue-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['all', 'active', 'at_risk', 'done'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
                filter === f
                  ? 'bg-amber-400 text-blue-900 border-amber-400'
                  : 'bg-blue-900/40 text-blue-300 border-blue-700/50 hover:border-amber-400/50'
              }`}
            >
              {f === 'all' ? 'Tümü' : f === 'active' ? 'Aktif' : f === 'at_risk' ? 'Risk' : 'Tamamlandı'}
              {f !== 'all' && (
                <span className="ml-1.5 opacity-70">
                  {f === 'active' ? stats.active : f === 'at_risk' ? stats.at_risk : stats.done}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Project Grid */}
        {isPending ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-blue-400">
            <div className="text-4xl mb-3">📭</div>
            <p>Bu kategoride proje yok.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((project, i) => (
              <ProjectCard key={project.id} project={project} index={i} />
            ))}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="animate-modal-in bg-blue-900 border border-blue-700/60 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-blue-800/50">
              <h2 className="text-lg font-bold text-white">Yeni Proje Oluştur</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-blue-400 hover:text-white transition-colors text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm text-blue-300 mb-1">Proje Adı *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="ör. Mobile Payment Infrastructure Renewal"
                  className="w-full bg-blue-950 border border-blue-700/50 rounded-lg px-3 py-2 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-blue-300 mb-1">Açıklama</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Projenin kısa açıklaması..."
                  rows={3}
                  className="w-full bg-blue-950 border border-blue-700/50 rounded-lg px-3 py-2 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-blue-300 mb-1">Hedef Tarih</label>
                  <input
                    type="date"
                    value={form.target_date}
                    onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
                    className="w-full bg-blue-950 border border-blue-700/50 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-blue-300 mb-1">Jira Proje Kodu</label>
                  <input
                    value={form.jira_key}
                    onChange={(e) => setForm((f) => ({ ...f, jira_key: e.target.value.toUpperCase() }))}
                    placeholder="ör. MPI"
                    className="w-full bg-blue-950 border border-blue-700/50 rounded-lg px-3 py-2 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-sm uppercase"
                  />
                </div>
              </div>

              {/* Team Members */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-blue-300">Ekip Üyeleri</label>
                  <button
                    type="button"
                    onClick={addMember}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    + Üye Ekle
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {members.map((m, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={m.name}
                        onChange={(e) => updateMember(i, 'name', e.target.value)}
                        placeholder="Ad Soyad"
                        className="flex-1 bg-blue-950 border border-blue-700/50 rounded-lg px-3 py-1.5 text-white placeholder-blue-600 focus:outline-none focus:border-amber-400 text-sm"
                      />
                      <select
                        value={m.role}
                        onChange={(e) => updateMember(i, 'role', e.target.value)}
                        className="bg-blue-950 border border-blue-700/50 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-amber-400 text-sm"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      {members.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMember(i)}
                          className="text-blue-500 hover:text-red-400 transition-colors text-sm px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{formError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-lg border border-blue-700/50 text-blue-300 hover:text-white hover:border-blue-600 transition-colors text-sm"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-blue-900 font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" />
                      Oluşturuluyor...
                    </span>
                  ) : (
                    'Proje Oluştur'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, index }: { project: ProjectWithIssues; index: number }) {
  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active;
  const isAtRisk = project.status === 'at_risk';

  return (
    <Link
      href={`/projects/${project.id}`}
      className={`block bg-blue-900/60 border rounded-xl p-5 hover:bg-blue-900/90 transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-950/50 animate-fade-in group ${
        isAtRisk ? 'border-amber-500/40' : 'border-blue-800/50'
      }`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${status.color}`}>
          {status.label}
        </span>
        {project.open_issues > 0 && (
          <span className="flex items-center gap-1 text-xs text-blue-300 bg-blue-800/60 px-2 py-1 rounded-full">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
            {project.open_issues} açık issue
          </span>
        )}
      </div>

      <h3 className="font-semibold text-white text-base mb-2 line-clamp-2 group-hover:text-amber-300 transition-colors">
        {project.title}
      </h3>

      {project.description && (
        <p className="text-blue-400 text-sm line-clamp-2 mb-4">{project.description}</p>
      )}

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-blue-800/40 text-xs text-blue-400">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          {project.team_size} kişi
        </div>

        {project.jira_key && (
          <div className="flex items-center gap-1 text-amber-400/70">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h11.5A2.25 2.25 0 0018 15.75V4.25A2.25 2.25 0 0015.75 2H4.25zm4.03 6.28a.75.75 0 00-1.06-1.06L5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75zm5.5 0a.75.75 0 00-1.06-1.06L10.5 9.44l-.97-.97a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.06 0l2.75-2.75z" clipRule="evenodd" />
            </svg>
            {project.jira_key}
          </div>
        )}

        {project.target_date && (
          <div className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
            {new Date(project.target_date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>

      {project.ai_generated === 1 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-purple-400">
          <span>✨</span>
          <span>AI ile oluşturuldu</span>
        </div>
      )}
    </Link>
  );
}
