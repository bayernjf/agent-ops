import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import { budgetFromForm, budgetToForm } from '../lib/budget';
import { formatCost, formatDuration, formatPercent } from '../lib/format';
import type { AgentRole, AgentTeam, KernelMetrics, KernelTask, TeamHandoff, TeamPipelinePlan } from '../types';

type HandoffDraft = {
  fromRoleId: string;
  toRoleId: string;
  note: string;
};

type TeamForm = {
  name: string;
  description: string;
  roleIds: string[];
  handoffs: HandoffDraft[];
  ownerRoleId: string;
  budgetCost: string;
  budgetInputTokens: string;
  budgetOutputTokens: string;
  enabled: boolean;
};

const emptyForm: TeamForm = {
  name: '',
  description: '',
  roleIds: [],
  handoffs: [],
  ownerRoleId: '',
  budgetCost: '',
  budgetInputTokens: '',
  budgetOutputTokens: '',
  enabled: true,
};

const toForm = (team: AgentTeam): TeamForm => {
  const budget = budgetToForm(team.budget);
  return {
    name: team.name,
    description: team.description ?? '',
    roleIds: team.roleIds,
    handoffs: team.handoffs.map(handoff => ({ fromRoleId: handoff.fromRoleId, toRoleId: handoff.toRoleId, note: handoff.note ?? '' })),
    ownerRoleId: team.ownerRoleId ?? '',
    budgetCost: budget.cost,
    budgetInputTokens: budget.inputTokens,
    budgetOutputTokens: budget.outputTokens,
    enabled: team.enabled,
  };
};

/**
 * The kernel Team registry. A team is a roster of roles plus the handoff edges between them,
 * so this view pairs the team list with a detail panel: roster, handoff edges, and the tasks
 * assigned to the team, where a pipeline paused at an approval gate is flagged as a blocker.
 * It is the human surface for the `/api/teams` CRUD routes.
 */
export function TeamsView() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [tasks, setTasks] = useState<KernelTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<TeamPipelinePlan | null>(null);
  const [planningTaskId, setPlanningTaskId] = useState<string | null>(null);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [teamMetrics, setTeamMetrics] = useState<KernelMetrics | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const teamsResponse = await apiFetch('/api/teams');
      const teamsPayload = (await teamsResponse.json().catch(() => null)) as { teams?: AgentTeam[]; error?: string } | null;
      if (!teamsResponse.ok) throw new Error(teamsPayload?.error ?? t('teams.load'));
      setTeams(Array.isArray(teamsPayload?.teams) ? teamsPayload.teams : []);

      const rolesResponse = await apiFetch('/api/roles');
      const rolesPayload = (await rolesResponse.json().catch(() => null)) as { roles?: AgentRole[]; error?: string } | null;
      if (!rolesResponse.ok) throw new Error(rolesPayload?.error ?? t('teams.load'));
      setRoles(Array.isArray(rolesPayload?.roles) ? rolesPayload.roles : []);

      const tasksResponse = await apiFetch('/api/tasks');
      const tasksPayload = (await tasksResponse.json().catch(() => null)) as KernelTask[] | { error?: string } | null;
      if (!tasksResponse.ok) throw new Error((tasksPayload as { error?: string } | null)?.error ?? t('teams.load'));
      setTasks(Array.isArray(tasksPayload) ? tasksPayload : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  const roleName = useMemo(() => {
    const names = new Map(roles.map(role => [role.id, role.name]));
    return (roleId: string) => names.get(roleId) ?? roleId;
  }, [roles]);

  const selected = useMemo(
    () => teams.find(team => team.id === selectedId) ?? (teams.length > 0 ? teams[0] : null),
    [teams, selectedId],
  );

  useEffect(() => {
    const teamId = selected?.id;
    if (!teamId) { setTeamMetrics(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch(`/api/metrics?teamId=${encodeURIComponent(teamId)}`);
        const body = (await response.json().catch(() => null)) as KernelMetrics | null;
        if (!cancelled && response.ok) setTeamMetrics(body);
      } catch {
        if (!cancelled) setTeamMetrics(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const startCreate = () => { setEditingId('new'); setForm(emptyForm); setError(''); };
  const startEdit = (team: AgentTeam) => { setEditingId(team.id); setForm(toForm(team)); setError(''); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm); };

  const update = <K extends keyof TeamForm>(key: K, value: TeamForm[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleRoster = (roleId: string) => {
    setForm(prev => {
      const removing = prev.roleIds.includes(roleId);
      return {
        ...prev,
        roleIds: removing ? prev.roleIds.filter(id => id !== roleId) : [...prev.roleIds, roleId],
        handoffs: removing
          ? prev.handoffs.filter(handoff => handoff.fromRoleId !== roleId && handoff.toRoleId !== roleId)
          : prev.handoffs,
        ownerRoleId: removing && prev.ownerRoleId === roleId ? '' : prev.ownerRoleId,
      };
    });
  };

  const updateHandoff = (index: number, patch: Partial<HandoffDraft>) => {
    setForm(prev => ({
      ...prev,
      handoffs: prev.handoffs.map((handoff, cursor) => (cursor === index ? { ...handoff, ...patch } : handoff)),
    }));
  };

  const addHandoff = () => {
    setForm(prev => ({
      ...prev,
      handoffs: [...prev.handoffs, { fromRoleId: prev.roleIds[0] ?? '', toRoleId: prev.roleIds[1] ?? '', note: '' }],
    }));
  };

  const removeHandoff = (index: number) => {
    setForm(prev => ({ ...prev, handoffs: prev.handoffs.filter((_handoff, cursor) => cursor !== index) }));
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const handoffs: TeamHandoff[] = form.handoffs
        .filter(handoff => handoff.fromRoleId && handoff.toRoleId)
        .map(handoff => ({
          fromRoleId: handoff.fromRoleId,
          toRoleId: handoff.toRoleId,
          ...(handoff.note.trim() ? { note: handoff.note.trim() } : {}),
        }));
      const budget = budgetFromForm(form.budgetCost, form.budgetInputTokens, form.budgetOutputTokens);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        roleIds: form.roleIds,
        handoffs,
        ownerRoleId: form.ownerRoleId || undefined,
        ...(budget ? { budget } : {}),
        enabled: form.enabled,
      };
      const response = editingId === 'new'
        ? await apiFetch('/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await apiFetch(`/api/teams/${encodeURIComponent(editingId ?? '')}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { error?: string; team?: AgentTeam } | null;
      if (!response.ok) throw new Error(body?.error ?? t('teams.save'));
      if (body?.team) setSelectedId(body.team.id);
      cancelEdit();
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (team: AgentTeam) => {
    setBusyTeamId(team.id);
    setError('');
    try {
      const response = await apiFetch(`/api/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('teams.delete'));
      if (selectedId === team.id) setSelectedId(null);
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.delete'));
    } finally {
      setBusyTeamId(null);
    }
  };

  const toggleEnabled = async (team: AgentTeam) => {
    setBusyTeamId(team.id);
    setError('');
    try {
      const response = await apiFetch(`/api/teams/${encodeURIComponent(team.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !team.enabled }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('teams.update'));
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.update'));
    } finally {
      setBusyTeamId(null);
    }
  };

  const teamTasks = selected ? tasks.filter(task => task.teamId === selected.id) : [];
  const blockers = teamTasks.filter(task => task.status === 'failed' || task.pipeline?.status === 'awaiting_approval');

  const planTask = async (task: KernelTask) => {
    setPlanningTaskId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/coordinator/plan`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { plan?: TeamPipelinePlan; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('teams.planFailed'));
      setPlanResult(body?.plan ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.planFailed'));
    } finally {
      setPlanningTaskId(null);
    }
  };

  const applyPlan = async () => {
    if (!planResult) return;
    setApplyingPlan(true);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(planResult.taskId)}/coordinator/apply`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('teams.applyFailed'));
      setPlanResult(null);
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('teams.applyFailed'));
    } finally {
      setApplyingPlan(false);
    }
  };
  const canAddHandoff = form.roleIds.length >= 2;

  return (
    <section className="teams-view" aria-label={t('teams.title')}>
      <div className="dashboard-content">
        <div className="section-heading">
          <div>
            <h2><Users size={18} aria-hidden="true" /> {t('teams.title')}</h2>
            <p>{t('teams.description')}</p>
          </div>
          <div className="teams-actions">
            <button className="icon-button" type="button" onClick={() => void loadData()} aria-label={t('common.refresh')} title={t('common.refresh')}><RefreshCw size={18} /></button>
            <button className="quiet-button" type="button" onClick={startCreate}><Plus size={16} aria-hidden="true" /> {t('teams.new')}</button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {editingId && (
          <div className="team-form">
            <h3>{editingId === 'new' ? t('teams.newTitle') : t('teams.editTitle')}</h3>
            <label>{t('teams.name')}<input value={form.name} onChange={event => update('name', event.target.value)} placeholder={t('teams.placeholderName')} /></label>
            <label>{t('teams.descriptionLabel')}<input value={form.description} onChange={event => update('description', event.target.value)} /></label>

            <fieldset className="team-roster">
              <legend>{t('teams.roster')}</legend>
              {roles.length === 0 ? (
                <p className="empty-state">{t('teams.noRoles')}</p>
              ) : (
                <div className="team-roster-list">
                  {roles.map(role => (
                    <label key={role.id} className="team-roster-item">
                      <input type="checkbox" checked={form.roleIds.includes(role.id)} onChange={() => toggleRoster(role.id)} />
                      <span>{role.name}</span>
                      {!role.enabled && <small>{t('teams.roleDisabled')}</small>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <label>{t('teams.owner')}
              <select value={form.ownerRoleId} onChange={event => update('ownerRoleId', event.target.value)}>
                <option value="">{t('teams.ownerNone')}</option>
                {form.roleIds.map(roleId => <option key={roleId} value={roleId}>{roleName(roleId)}</option>)}
              </select>
              <small>{t('teams.ownerHint')}</small>
            </label>

            <fieldset className="budget-fieldset">
              <legend>{t('teams.budgetTitle')}</legend>
              <div className="form-grid-3">
                <label>{t('teams.budgetCost')}<input inputMode="decimal" value={form.budgetCost} onChange={event => update('budgetCost', event.target.value)} placeholder={t('teams.budgetCostPlaceholder')} /></label>
                <label>{t('teams.budgetInputTokens')}<input inputMode="numeric" value={form.budgetInputTokens} onChange={event => update('budgetInputTokens', event.target.value)} placeholder={t('teams.budgetPlaceholder')} /></label>
                <label>{t('teams.budgetOutputTokens')}<input inputMode="numeric" value={form.budgetOutputTokens} onChange={event => update('budgetOutputTokens', event.target.value)} placeholder={t('teams.budgetPlaceholder')} /></label>
              </div>
              <small>{t('teams.budgetHint')}</small>
            </fieldset>

            <fieldset className="team-handoffs">
              <legend>{t('teams.handoffs')}</legend>
              {form.handoffs.length === 0 ? (
                <p className="empty-state">{t('teams.noHandoffs')}</p>
              ) : (
                form.handoffs.map((handoff, index) => (
                  <div className="team-handoff-row" key={`handoff-${index}`}>
                    <label>{t('teams.fromRole')}
                      <select value={handoff.fromRoleId} onChange={event => updateHandoff(index, { fromRoleId: event.target.value })}>
                        {form.roleIds.map(roleId => <option key={roleId} value={roleId}>{roleName(roleId)}</option>)}
                      </select>
                    </label>
                    <label>{t('teams.toRole')}
                      <select value={handoff.toRoleId} onChange={event => updateHandoff(index, { toRoleId: event.target.value })}>
                        {form.roleIds.map(roleId => <option key={roleId} value={roleId}>{roleName(roleId)}</option>)}
                      </select>
                    </label>
                    <label>{t('teams.note')}
                      <input value={handoff.note} onChange={event => updateHandoff(index, { note: event.target.value })} placeholder={t('teams.notePlaceholder')} />
                    </label>
                    <button className="icon-button" type="button" onClick={() => removeHandoff(index)} aria-label={t('teams.removeHandoff')} title={t('teams.removeHandoff')}><Trash2 size={15} /></button>
                  </div>
                ))
              )}
              <button className="secondary-button" type="button" onClick={addHandoff} disabled={!canAddHandoff}><Plus size={14} aria-hidden="true" /> {t('teams.addHandoff')}</button>
              {!canAddHandoff && <p className="team-hint">{t('teams.handoffHint')}</p>}
            </fieldset>

            <label className="team-enabled"><input type="checkbox" checked={form.enabled} onChange={event => update('enabled', event.target.checked)} /> {t('teams.enabled')}</label>
            <div className="team-form-actions">
              <button className="secondary-button" type="button" onClick={cancelEdit} disabled={saving}><X size={14} aria-hidden="true" /> {t('common.cancel')}</button>
              <button className="primary-button" type="button" onClick={() => void submit()} disabled={saving || !form.name.trim()}><Check size={14} aria-hidden="true" /> {saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        )}

        <div className="team-table" role="table" aria-label={t('teams.title')}>
          <div className="team-head" role="row">
            <span>{t('teams.nameCol')}</span>
            <span>{t('teams.rosterCol')}</span>
            <span>{t('teams.handoffsCol')}</span>
            <span>{t('teams.statusCol')}</span>
            <span aria-hidden="true" />
          </div>
          {loading ? (
            <p className="empty-state">{t('teams.loading')}</p>
          ) : teams.length === 0 ? (
            <p className="empty-state">{t('teams.empty')}</p>
          ) : (
            teams.map(team => (
              <div className={`team-row${selected?.id === team.id ? ' selected' : ''}`} role="row" key={team.id}>
                <button className="team-name" type="button" onClick={() => setSelectedId(team.id)}>
                  <strong>{team.name}</strong>
                  <small>{team.id}</small>
                </button>
                <span>{t('teams.roleCount').replace('{count}', String(team.roleIds.length))}</span>
                <span>{t('teams.handoffCount').replace('{count}', String(team.handoffs.length))}</span>
                <button className={`team-status ${team.enabled ? 'on' : 'off'}`} type="button" onClick={() => void toggleEnabled(team)} disabled={busyTeamId === team.id}>
                  {team.enabled ? t('teams.on') : t('teams.off')}
                </button>
                <span className="team-row-actions">
                  <button className="icon-button" type="button" onClick={() => startEdit(team)} aria-label={t('common.edit')} title={t('common.edit')}><Pencil size={15} /></button>
                  <button className="icon-button" type="button" onClick={() => void remove(team)} disabled={busyTeamId === team.id} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={15} /></button>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="team-detail">
          {!selected ? (
            <p className="empty-state">{t('teams.detailEmpty')}</p>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.description ?? t('teams.detailFallback')}</p>
                  <p>{selected.ownerRoleId ? `${t('teams.owner')}: ${roleName(selected.ownerRoleId)}` : t('teams.ownerNone')}</p>
                </div>
              </div>

              <div className="team-detail-grid">
                <div className="team-panel">
                  <h3>{t('teams.rosterTitle')}</h3>
                  {selected.roleIds.length === 0 ? (
                    <p className="empty-state">{t('teams.emptyRoster')}</p>
                  ) : (
                    <ul className="team-role-list">
                      {selected.roleIds.map(roleId => {
                        const role = roles.find(candidate => candidate.id === roleId);
                        return (
                          <li key={roleId}>
                            <span>{roleName(roleId)}</span>
                            {!role?.enabled && <small>{t('teams.roleDisabled')}</small>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="team-panel">
                  <h3>{t('teams.handoffTitle')}</h3>
                  {selected.handoffs.length === 0 ? (
                    <p className="empty-state">{t('teams.noHandoffs')}</p>
                  ) : (
                    <ul className="team-handoff-list">
                      {selected.handoffs.map((handoff, index) => (
                        <li key={`edge-${index}`}>
                          <span className="team-edge">{roleName(handoff.fromRoleId)} → {roleName(handoff.toRoleId)}</span>
                          {handoff.note && <small>{handoff.note}</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="team-panel">
                  <h3>{t('teams.taskQueue')}</h3>
                  {teamTasks.length === 0 ? (
                    <p className="empty-state">{t('teams.noTasks')}</p>
                  ) : (
                    <ul className="team-task-list">
                      {teamTasks.map(task => (
                        <li key={task.id}>
                          <span>{task.title}</span>
                          <span className={`state ${task.status}`}>{t(`tasks.state.${task.status}` as KeyPath)}</span>
                          {task.pipeline?.status === 'awaiting_approval' && (
                            <span className="state awaiting_approval">{t('teams.gate')}</span>
                          )}
                          {task.status === 'queued' && (
                            <button className="quiet-button" type="button" onClick={() => void planTask(task)} disabled={planningTaskId === task.id}>
                              {t('teams.plan')}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="team-panel">
                  <h3>{t('teams.blockers')}</h3>
                  {blockers.length === 0 ? (
                    <p className="empty-state">{t('teams.noBlockers')}</p>
                  ) : (
                    <ul className="team-task-list">
                      {blockers.map(task => (
                        <li key={task.id}>
                          <span>{task.title}</span>
                          <span className={`state ${task.status}`}>{t(`tasks.state.${task.status}` as KeyPath)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="team-panel">
                  <h3>{t('teams.usage')}</h3>
                  {teamMetrics ? (
                    <ul className="team-metric-list">
                      <li><span>{t('metrics.successRate')}</span><strong>{formatPercent(teamMetrics.runs.successRate)}</strong></li>
                      <li><span>{t('metrics.runs')}</span><strong>{teamMetrics.runs.total}</strong></li>
                      <li><span>{t('metrics.cost')}</span><strong>{formatCost(teamMetrics.usage.costUsd)}</strong></li>
                      <li><span>{t('metrics.tokens')}</span><strong>{teamMetrics.usage.inputTokens ?? '—'} / {teamMetrics.usage.outputTokens ?? '—'}</strong></li>
                      <li><span>{t('metrics.avgDuration')}</span><strong>{teamMetrics.timing.averageDurationMs === null ? '—' : formatDuration(teamMetrics.timing.averageDurationMs)}</strong></li>
                    </ul>
                  ) : (
                    <p className="empty-state">{t('metrics.loading')}</p>
                  )}
                </div>
              </div>

              {planResult && (
                <div className="team-panel team-plan">
                  <h3>{t('teams.planTitle')}</h3>
                  <p>{t('teams.planHint')}</p>
                  <ol className="team-role-list">
                    {planResult.steps.map(step => (
                      <li key={step.id}>
                        <span>{step.name}</span>
                        {step.roleId && <small>{step.roleId}</small>}
                      </li>
                    ))}
                  </ol>
                  {planResult.warnings.length > 0 && (
                    <ul className="team-plan-warnings">
                      {planResult.warnings.map(warning => <li key={warning}>{warning}</li>)}
                    </ul>
                  )}
                  <div className="team-form-actions">
                    <button className="secondary-button" type="button" onClick={() => setPlanResult(null)} disabled={applyingPlan}>{t('common.cancel')}</button>
                    <button className="primary-button" type="button" onClick={() => void applyPlan()} disabled={applyingPlan}>
                      {applyingPlan ? t('common.saving') : t('teams.applyPlan')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
