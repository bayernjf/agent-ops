import { useCallback, useEffect, useState } from 'react';
import { Check, FlaskConical, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import { budgetFromForm, budgetToForm } from '../lib/budget';
import type { AgentRole, RoleApprovalMode, RoleTemplate, RoleTestPlan } from '../types';

type RoleForm = {
  name: string;
  description: string;
  baseAgentId: string;
  profileId: string;
  systemPrompt: string;
  acceptanceCriteria: string;
  allowedTools: string;
  blockedTools: string;
  approvalMode: RoleApprovalMode;
  budgetCost: string;
  budgetInputTokens: string;
  budgetOutputTokens: string;
  enabled: boolean;
};

const emptyForm: RoleForm = {
  name: '',
  description: '',
  baseAgentId: '',
  profileId: '',
  systemPrompt: '',
  acceptanceCriteria: '',
  allowedTools: '',
  blockedTools: '',
  approvalMode: 'human',
  budgetCost: '',
  budgetInputTokens: '',
  budgetOutputTokens: '',
  enabled: true,
};

const toForm = (role: AgentRole): RoleForm => {
  const budget = budgetToForm(role.budget);
  return {
    name: role.name,
    description: role.description ?? '',
    baseAgentId: role.baseAgentId ?? '',
    profileId: role.profileId ?? '',
    systemPrompt: role.systemPrompt ?? '',
    acceptanceCriteria: role.acceptanceCriteria.join('\n'),
    allowedTools: role.runtimePolicy.allowedTools.join(', '),
    blockedTools: role.runtimePolicy.blockedTools.join(', '),
    approvalMode: role.runtimePolicy.approvalMode,
    budgetCost: budget.cost,
    budgetInputTokens: budget.inputTokens,
    budgetOutputTokens: budget.outputTokens,
    enabled: role.enabled,
  };
};

const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
const splitCommas = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

/**
 * The kernel Role registry. Roles bind a base Agent or an existing Profile to a
 * system prompt, acceptance criteria and a runtime tool policy; the task/run
 * control plane then inherits them. This view is the human surface for the
 * `/api/roles` CRUD routes, kept parallel to the webapp delivery views.
 */
export function RolesView() {
  const { t } = useI18n();
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [testPlan, setTestPlan] = useState<RoleTestPlan | null>(null);
  const [testingRoleId, setTestingRoleId] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/roles');
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const body = payload as { error?: string } | null;
        throw new Error(body?.error ?? t('roles.load'));
      }
      const body = payload as { roles?: AgentRole[] } | null;
      setRoles(Array.isArray(body?.roles) ? body.roles : []);

      // Templates only pre-fill the create form; a missing list must not block the role table.
      const templateResponse = await apiFetch('/api/role-templates');
      const templatePayload = (await templateResponse.json().catch(() => null)) as { templates?: RoleTemplate[] } | null;
      if (templateResponse.ok && Array.isArray(templatePayload?.templates)) setTemplates(templatePayload.templates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadRoles(); }, [loadRoles]);

  const startCreate = () => { setEditingId('new'); setForm(emptyForm); setError(''); };
  const startEdit = (role: AgentRole) => { setEditingId(role.id); setForm(toForm(role)); setError(''); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm); };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const budget = budgetFromForm(form.budgetCost, form.budgetInputTokens, form.budgetOutputTokens);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        baseAgentId: form.baseAgentId.trim() || undefined,
        profileId: form.profileId.trim() || undefined,
        systemPrompt: form.systemPrompt.trim() || undefined,
        acceptanceCriteria: splitLines(form.acceptanceCriteria),
        runtimePolicy: {
          allowedTools: splitCommas(form.allowedTools),
          blockedTools: splitCommas(form.blockedTools),
          approvalMode: form.approvalMode,
        },
        ...(budget ? { budget } : {}),
        enabled: form.enabled,
      };
      const response = editingId === 'new'
        ? await apiFetch('/api/roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await apiFetch(`/api/roles/${encodeURIComponent(editingId ?? '')}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('roles.save'));
      cancelEdit();
      await loadRoles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role: AgentRole) => {
    setBusyRoleId(role.id);
    setError('');
    try {
      const response = await apiFetch(`/api/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('roles.delete'));
      await loadRoles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.delete'));
    } finally {
      setBusyRoleId(null);
    }
  };

  const toggleEnabled = async (role: AgentRole) => {
    setBusyRoleId(role.id);
    setError('');
    try {
      const response = await apiFetch(`/api/roles/${encodeURIComponent(role.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !role.enabled }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('roles.update'));
      await loadRoles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.update'));
    } finally {
      setBusyRoleId(null);
    }
  };

  const update = <K extends keyof RoleForm>(key: K, value: RoleForm[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const testRole = async (role: AgentRole) => {
    setTestingRoleId(role.id);
    setError('');
    try {
      const response = await apiFetch(`/api/roles/${encodeURIComponent(role.id)}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => null)) as { plan?: RoleTestPlan; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('roles.testFailed'));
      setTestPlan(body?.plan ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.testFailed'));
    } finally {
      setTestingRoleId(null);
    }
  };

  const applyTemplate = (template: RoleTemplate) => {
    setForm({
      name: template.name,
      description: template.description,
      baseAgentId: template.baseAgentId,
      profileId: '',
      systemPrompt: template.systemPrompt,
      acceptanceCriteria: template.acceptanceCriteria.join('\n'),
      allowedTools: template.runtimePolicy.allowedTools.join(', '),
      blockedTools: template.runtimePolicy.blockedTools.join(', '),
      approvalMode: template.runtimePolicy.approvalMode,
      budgetCost: '',
      budgetInputTokens: '',
      budgetOutputTokens: '',
      enabled: true,
    });
  };

  const approvalLabel = (mode: RoleApprovalMode) => t(`roles.approvalMode.${mode}` as KeyPath);

  return (
    <section className="roles-view" aria-label={t('roles.title')}>
      <div className="dashboard-content">
        <div className="section-heading">
          <div>
            <h2><ShieldCheck size={18} aria-hidden="true" /> {t('roles.title')}</h2>
            <p>{t('roles.description')}</p>
          </div>
          <div className="roles-actions">
            <button className="icon-button" type="button" onClick={() => void loadRoles()} aria-label={t('common.refresh')} title={t('common.refresh')}><RefreshCw size={18} /></button>
            <button className="quiet-button" type="button" onClick={startCreate}><Plus size={16} aria-hidden="true" /> {t('roles.new')}</button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {editingId && (
          <div className="role-form">
            <h3>{editingId === 'new' ? t('roles.newTitle') : t('roles.editTitle')}</h3>
            {editingId === 'new' && templates.length > 0 && (
              <div className="role-templates">
                <span>{t('roles.templates')}</span>
                <p>{t('roles.templateHint')}</p>
                <div className="role-template-list">
                  {templates.map(template => (
                    <button className="role-template" key={template.id} type="button" onClick={() => applyTemplate(template)}>
                      <strong>{template.name}</strong>
                      <small>{template.description}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>{t('roles.name')}<input value={form.name} onChange={e => update('name', e.target.value)} placeholder={t('roles.placeholderName')} /></label>
            <label>{t('roles.descriptionLabel')}<input value={form.description} onChange={e => update('description', e.target.value)} /></label>
            <div className="role-form-grid">
              <label>{t('roles.baseAgent')}<input value={form.baseAgentId} onChange={e => update('baseAgentId', e.target.value)} placeholder={t('roles.placeholderBaseAgent')} /></label>
              <label>{t('roles.profile')}<input value={form.profileId} onChange={e => update('profileId', e.target.value)} placeholder={t('roles.placeholderProfile')} /></label>
            </div>
            <label>{t('roles.systemPrompt')}<textarea rows={4} value={form.systemPrompt} onChange={e => update('systemPrompt', e.target.value)} /></label>
            <label>{t('roles.acceptance')}<textarea rows={3} value={form.acceptanceCriteria} onChange={e => update('acceptanceCriteria', e.target.value)} placeholder={t('roles.acceptancePlaceholder')} /></label>
            <div className="role-form-grid">
              <label>{t('roles.allowedTools')}<input value={form.allowedTools} onChange={e => update('allowedTools', e.target.value)} placeholder={t('roles.placeholderAllowedTools')} /></label>
              <label>{t('roles.blockedTools')}<input value={form.blockedTools} onChange={e => update('blockedTools', e.target.value)} placeholder={t('roles.placeholderBlockedTools')} /></label>
            </div>
            <div className="role-form-grid">
              <label>{t('roles.approvalModeLabel')}
                <select value={form.approvalMode} onChange={e => update('approvalMode', e.target.value as RoleApprovalMode)}>
                  <option value="auto">{approvalLabel('auto')}</option>
                  <option value="human">{approvalLabel('human')}</option>
                  <option value="strict">{approvalLabel('strict')}</option>
                </select>
              </label>
              <label className="role-enabled"><input type="checkbox" checked={form.enabled} onChange={e => update('enabled', e.target.checked)} /> {t('roles.enabled')}</label>
            </div>
            <fieldset className="budget-fieldset">
              <legend>{t('roles.budgetTitle')}</legend>
              <div className="form-grid-3">
                <label>{t('roles.budgetCost')}<input inputMode="decimal" value={form.budgetCost} onChange={e => update('budgetCost', e.target.value)} placeholder={t('roles.budgetCostPlaceholder')} /></label>
                <label>{t('roles.budgetInputTokens')}<input inputMode="numeric" value={form.budgetInputTokens} onChange={e => update('budgetInputTokens', e.target.value)} placeholder={t('roles.budgetPlaceholder')} /></label>
                <label>{t('roles.budgetOutputTokens')}<input inputMode="numeric" value={form.budgetOutputTokens} onChange={e => update('budgetOutputTokens', e.target.value)} placeholder={t('roles.budgetPlaceholder')} /></label>
              </div>
              <small>{t('roles.budgetHint')}</small>
            </fieldset>
            <div className="role-form-actions">
              <button className="secondary-button" type="button" onClick={cancelEdit} disabled={saving}><X size={14} aria-hidden="true" /> {t('common.cancel')}</button>
              <button className="primary-button" type="button" onClick={() => void submit()} disabled={saving || !form.name.trim()}><Check size={14} aria-hidden="true" /> {saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        )}

        <div className="role-table" role="table" aria-label={t('roles.title')}>
          <div className="role-head" role="row">
            <span>{t('roles.nameCol')}</span>
            <span>{t('roles.bindingCol')}</span>
            <span>{t('roles.approvalCol')}</span>
            <span>{t('roles.statusCol')}</span>
            <span aria-hidden="true" />
          </div>
          {loading ? (
            <p className="empty-state">{t('roles.loading')}</p>
          ) : roles.length === 0 ? (
            <p className="empty-state">{t('roles.empty')}</p>
          ) : (
            roles.map(role => (
              <div className="role-row" role="row" key={role.id}>
                <div className="role-name">
                  <strong>{role.name}</strong>
                  <small>{role.id}</small>
                </div>
                <span className="role-binding">{role.profileId ? `profile: ${role.profileId}` : `agent: ${role.baseAgentId ?? '—'}`}</span>
                <span>{approvalLabel(role.runtimePolicy.approvalMode)}</span>
                <button className={`role-status ${role.enabled ? 'on' : 'off'}`} type="button" onClick={() => void toggleEnabled(role)} disabled={busyRoleId === role.id}>
                  {role.enabled ? t('roles.on') : t('roles.off')}
                </button>
                <span className="role-actions">
                  <button className="icon-button" type="button" onClick={() => void testRole(role)} disabled={testingRoleId === role.id} aria-label={t('roles.test')} title={t('roles.test')}><FlaskConical size={15} /></button>
                  <button className="icon-button" type="button" onClick={() => startEdit(role)} aria-label={t('common.edit')} title={t('common.edit')}><Pencil size={15} /></button>
                  <button className="icon-button" type="button" onClick={() => void remove(role)} disabled={busyRoleId === role.id} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={15} /></button>
                </span>
              </div>
            ))
          )}
        </div>

        {testPlan && (
          <div className="role-test">
            <div className="section-heading">
              <div>
                <h3>{t('roles.testTitle')}: {testPlan.name}</h3>
                <p>{testPlan.objective}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setTestPlan(null)} aria-label={t('common.close')} title={t('common.close')}><X size={16} /></button>
            </div>
            <div className="role-test-meta">
              <span className={testPlan.executable ? 'role-test-ok' : 'role-test-bad'}>
                {testPlan.executable ? t('roles.testExecutable') : t('roles.testNotExecutable')}
              </span>
              <span>{t('roles.baseAgent')}: {testPlan.baseAgentId ?? '—'} ({testPlan.adapterStatus})</span>
              {testPlan.profileId && <span>{t('roles.profile')}: {testPlan.profileId}</span>}
              {testPlan.reason && <span>{testPlan.reason}</span>}
            </div>
            {testPlan.command && (
              <div className="role-test-command">
                <span>{t('roles.testCommand')}</span>
                <code>{testPlan.command.join(' ')}</code>
              </div>
            )}
            {testPlan.warnings.length > 0 && (
              <div className="role-test-warnings">
                <span>{t('roles.testWarnings')}</span>
                <ul>
                  {testPlan.warnings.map(warning => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
