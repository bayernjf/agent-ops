import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import type { AgentRole, RoleApprovalMode } from '../types';

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
  enabled: true,
};

const toForm = (role: AgentRole): RoleForm => ({
  name: role.name,
  description: role.description ?? '',
  baseAgentId: role.baseAgentId ?? '',
  profileId: role.profileId ?? '',
  systemPrompt: role.systemPrompt ?? '',
  acceptanceCriteria: role.acceptanceCriteria.join('\n'),
  allowedTools: role.runtimePolicy.allowedTools.join(', '),
  blockedTools: role.runtimePolicy.blockedTools.join(', '),
  approvalMode: role.runtimePolicy.approvalMode,
  enabled: role.enabled,
});

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

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
                  <button className="icon-button" type="button" onClick={() => startEdit(role)} aria-label={t('common.edit')} title={t('common.edit')}><Pencil size={15} /></button>
                  <button className="icon-button" type="button" onClick={() => void remove(role)} disabled={busyRoleId === role.id} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={15} /></button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
