import { describe, expect, it } from 'vitest';
import {
  parseGitUploadPackRefs,
  parseGithubAtomHeadSha,
  pickBranchSha,
} from './github-revision.js';

function pkt(payload: string): string {
  const len = payload.length + 4;
  return `${len.toString(16).padStart(4, '0')}${payload}`;
}

describe('parseGitUploadPackRefs', () => {
  it('reads HEAD and branch tips from pkt-lines', () => {
    const raw =
      pkt('# service=git-upload-pack\n') +
      '0000' +
      pkt('8eb85a1817ec01d1b772b85e1f8281280c40ec93 HEAD\0multi_ack\n') +
      pkt('8eb85a1817ec01d1b772b85e1f8281280c40ec93 refs/heads/main\n');
    const refs = parseGitUploadPackRefs(raw);
    expect(refs.HEAD).toBe('8eb85a1817ec01d1b772b85e1f8281280c40ec93');
    expect(pickBranchSha(refs, 'main')).toBe('8eb85a1817ec01d1b772b85e1f8281280c40ec93');
  });
});

describe('parseGithubAtomHeadSha', () => {
  it('reads the newest commit id', () => {
    const xml = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>tag:github.com,2008:Grit::Commit/8eb85a1817ec01d1b772b85e1f8281280c40ec93</id>
  </entry>
</feed>`;
    expect(parseGithubAtomHeadSha(xml)).toBe('8eb85a1817ec01d1b772b85e1f8281280c40ec93');
  });
});
