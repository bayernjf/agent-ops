import { Fragment, useEffect, useRef, useState } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import type { PolicyPreviewResponse, PolicyVerdict, RoleRuntimePolicy } from '../types';

type PolicyPreviewProps = {
  policy: RoleRuntimePolicy;
};

const policySignature = (policy: RoleRuntimePolicy) => JSON.stringify(policy);

/**
 * Preview a Role tool policy across every registered Runtime. The kernel route returns the canonical
 * allow/deny decisions plus how faithfully each Runtime can enforce them; this panel keeps the
 * judgement visible before a Role is saved. Verdicts are cleared as soon as the edited policy
 * changes so a stale result is never mistaken for the current policy.
 */
export function PolicyPreview({ policy }: PolicyPreviewProps) {
  const { t } = useI18n();
  const [result, setResult] = useState<PolicyPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const signature = policySignature(policy);
  const latestSignature = useRef(signature);
  latestSignature.current = signature;

  useEffect(() => {
    setResult(null);
    setError('');
  }, [signature]);

  const preview = async () => {
    const requestedSignature = signature;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/policy/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const payload = (await response.json().catch(() => null)) as (PolicyPreviewResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(payload?.error ?? t('policy.previewFailed'));
      if (requestedSignature !== latestSignature.current) return;
      setResult(payload && Array.isArray(payload.verdicts) ? payload : null);
    } catch (cause) {
      if (requestedSignature === latestSignature.current) {
        setResult(null);
        setError(cause instanceof Error ? cause.message : t('policy.previewFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const capabilityLabel = (capability: PolicyVerdict['capability']) => t(`policy.capability.${capability}` as KeyPath);
  const enforcementLabel = (enforcement: PolicyVerdict['enforcement']) => t(`policy.enforcement.${enforcement}` as KeyPath);
  const approvalLabel = (mode: RoleRuntimePolicy['approvalMode']) => t(`roles.approvalMode.${mode}` as KeyPath);

  return (
    <section className="policy-preview" aria-label={t('policy.title')}>
      <div className="policy-preview-head">
        <div>
          <h3>{t('policy.title')}</h3>
          <p>{t('policy.description')}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void preview()} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {loading ? t('policy.previewing') : t('policy.previewAction')}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {!result && !error && (
        <p className="policy-empty">{loading ? t('policy.loading') : t('policy.empty')}</p>
      )}

      {result && (
        <div className="policy-results">
          <p className="policy-summary">
            {t('policy.summary', { count: result.verdicts.length })}
            <span>{t('policy.approvalSummary', { mode: approvalLabel(result.policy.approvalMode) })}</span>
          </p>
          {result.policy.allowedTools.length === 0 && result.policy.blockedTools.length === 0 && (
            <p className="policy-note">{t('policy.noRestrictions')}</p>
          )}
          <div className="policy-table-wrap">
            <table className="policy-table">
              <thead>
                <tr>
                  <th scope="col">{t('policy.runtimeColumn')}</th>
                  <th scope="col">{t('policy.enforcementColumn')}</th>
                  <th scope="col">{t('policy.readOnlyColumn')}</th>
                  <th scope="col">{t('policy.humanGateColumn')}</th>
                  <th scope="col">{t('policy.decisionsColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {result.verdicts.map(verdict => (
                  <Fragment key={verdict.runtimeId}>
                    <tr>
                      <td>
                        <strong className="policy-runtime">{verdict.runtimeId}</strong>
                        <small className={`policy-capability ${verdict.capability}`}>{capabilityLabel(verdict.capability)}</small>
                      </td>
                      <td><span className={`policy-enforcement ${verdict.enforcement}`}>{enforcementLabel(verdict.enforcement)}</span></td>
                      <td>{verdict.readOnly ? t('policy.yes') : t('policy.no')}</td>
                      <td>{verdict.approval.humanGate ? t('policy.yes') : t('policy.no')}</td>
                      <td>
                        <details className="policy-verdict-details">
                          <summary>{t('policy.decisionCount', { count: verdict.decisions.length })}</summary>
                          <div className="policy-decisions">
                            {verdict.decisions.length === 0
                              ? <p>{t('policy.noDecisions')}</p>
                              : verdict.decisions.map(decision => (
                                <div className={`policy-decision ${decision.decision}`} key={`${decision.tool}-${decision.decision}`}>
                                  <strong>{decision.tool}</strong>
                                  <span>{decision.decision === 'allow' ? t('policy.allow') : t('policy.deny')}</span>
                                  {decision.reason && <small>{decision.reason}</small>}
                                </div>
                              ))}
                          </div>
                          {verdict.warnings.length > 0 && (
                            <div className="policy-warnings">
                              <strong>{t('policy.warnings')}</strong>
                              <ul>
                                {verdict.warnings.map(warning => <li key={warning}>{warning}</li>)}
                              </ul>
                            </div>
                          )}
                          {verdict.unsupportedReason && (
                            <p className="policy-unsupported"><strong>{t('policy.unsupportedReason')}</strong> {verdict.unsupportedReason}</p>
                          )}
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
