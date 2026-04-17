import { describe, expect, it } from 'bun:test';
import {
  buildEmailDraftBlocks,
  shouldUseEmailDraftMode,
} from '../../../src/services/orchestrator/orchestrator-email.service';

describe('orchestrator-email.service', () => {
  it('builds blocks from structured JSON email envelopes', () => {
    const input = JSON.stringify({
      intro: 'Here are two options.',
      drafts: [
        {
          label: 'Formal',
          subject: 'Application for Leave',
          bodyMarkdown: 'Dear Manager,\n\nI would like to request leave for two days.\n\nRegards,\nAjay',
        },
        {
          label: 'Friendly',
          subject: 'Quick Leave Request',
          bodyMarkdown: 'Hi,\n\nCan I take two days off this week?\n\nThanks,\nAjay',
        },
      ],
      outro: 'I can tailor these further if needed.',
    });

    const result = buildEmailDraftBlocks(input);

    expect(result.emailJsonParseOk).toBe(true);
    expect(result.emailDraftCount).toBe(2);
    expect(result.emailFallbackUsed).toBe(false);
    expect(result.blocks?.[0]).toEqual({ type: 'markdown', text: 'Here are two options.' });
    expect(result.blocks?.[1]).toMatchObject({
      type: 'email_draft',
      label: 'Formal',
      subject: 'Application for Leave',
    });
    expect(result.blocks?.[2]).toMatchObject({
      type: 'email_draft',
      label: 'Friendly',
      subject: 'Quick Leave Request',
    });
    expect(result.blocks?.[3]).toEqual({ type: 'markdown', text: 'I can tailor these further if needed.' });
  });

  it('falls back to parsing multi-variant subject/body drafts from plain text', () => {
    const input = [
      'Professional Version',
      'Subject: Project Update',
      '',
      'Dear Team,',
      '',
      'The project is on track and we will deliver by Friday.',
      '',
      'Regards,',
      'Ajay',
      '',
      'Friendly Version',
      'Subject: Quick Project Update',
      '',
      'Hi team,',
      '',
      'Everything is on track and we should be done by Friday.',
      '',
      'Thanks,',
      'Ajay',
    ].join('\n');

    const result = buildEmailDraftBlocks(input);

    expect(result.emailJsonParseOk).toBe(false);
    expect(result.emailDraftCount).toBe(2);
    expect(result.emailFallbackUsed).toBe(true);
    expect(result.blocks?.filter((block) => block.type === 'email_draft')).toHaveLength(2);
    expect(result.blocks?.[0]).toMatchObject({ type: 'email_draft', subject: 'Project Update' });
    expect(result.blocks?.[1]).toMatchObject({ type: 'email_draft', subject: 'Quick Project Update' });
  });

  it('returns no draft blocks for non-email responses', () => {
    const result = buildEmailDraftBlocks('Here is a short answer with no subject line or email structure.');

    expect(result).toEqual({
      blocks: null,
      emailJsonParseOk: false,
      emailDraftCount: 0,
      emailFallbackUsed: false,
    });
  });

  it('detects email-draft mode prompts conservatively', () => {
    expect(shouldUseEmailDraftMode('Please draft a resignation email for me.')).toBe(true);
    expect(shouldUseEmailDraftMode('Write an email with subject and body.')).toBe(true);
    expect(shouldUseEmailDraftMode('Give me a short summary of this workflow result.')).toBe(false);
  });
});
