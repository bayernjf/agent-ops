import { describe, expect, it } from 'vitest';
import { renderAsync } from './render';
import { I18nProvider } from '../src/i18n/i18n';
import { PolicyPreview } from '../src/views/PolicyPreview';

describe('Policy preview panel', () => {
  it('renders the cross-runtime preview shell before a request is made', async () => {
    const html = await renderAsync(
      <I18nProvider>
        <PolicyPreview policy={{ allowedTools: ['Read'], blockedTools: ['Bash'], approvalMode: 'human' }} />
      </I18nProvider>,
    );

    expect(html).toContain('Cross-runtime policy preview');
    expect(html).toContain('Preview policy');
    expect(html).toContain('No preview yet');
  });
});
