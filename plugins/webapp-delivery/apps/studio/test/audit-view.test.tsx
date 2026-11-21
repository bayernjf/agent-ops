import { describe, expect, it } from 'vitest';
import { renderAsync } from './render';
import { I18nProvider } from '../src/i18n/i18n';
import { AuditView } from '../src/views/AuditView';

describe('Audit view shell', () => {
  it('renders the filters and export actions before the event stream loads', async () => {
    const html = await renderAsync(
      <I18nProvider>
        <AuditView />
      </I18nProvider>,
    );

    expect(html).toContain('Audit');
    expect(html).toContain('Export audit JSON');
    expect(html).toContain('Export task evidence');
    expect(html).toContain('Task ID');
    expect(html).toContain('Team ID');
    expect(html).toContain('Event type');
    expect(html).toContain('Loading audit events…');
  });
});
